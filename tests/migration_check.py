import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright

async def run():
    first = json.loads(Path('/home/user/rm-sb/test-output/ops-first.json').read_text())
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        context = await browser.new_context()
        page = await context.new_page()
        await page.goto('http://localhost:4200')
        await page.get_by_role('heading',name='Connexion à RM-SB').wait_for()
        await page.evaluate('''async backup => {
          const m = await import('/src/web/lib/database.ts');
          await m.db.delete();
          const request = indexedDB.open('RM-SB',10);
          request.onupgradeneeded = () => {
            const d = request.result;
            for (const [name,key] of [['transactions','atc'],['plans','date'],['settings','id'],['users','name'],['imports','id']]) {
              const s = d.createObjectStore(name,{keyPath:key});
              for (const index of name==='transactions' ? ['exit','product','transporter'] : name==='imports' ? ['date'] : []) s.createIndex(index,index);
            }
          };
          const d = await new Promise((resolve,reject) => {request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
          const admin = backup.users.find(u=>u.name==='ADMIN');
          admin.hash = await m.passwordHash('Migration@2026:',admin.salt);
          const tx = d.transaction(['transactions','plans','settings','users','imports'],'readwrite');
          tx.objectStore('transactions').put({...backup.transactions[0],special:true,assignedBy:'Ancien manuel'});
          tx.objectStore('plans').put({date:'2026-11-02',pozzolana:7,granite:2});
          tx.objectStore('settings').put({...backup.settings,organization:'Migration test',pozzolanaCapacity:48});
          backup.users.forEach(u=>tx.objectStore('users').put(u));
          await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
          d.close();
        }''', first)
        await page.reload()
        await page.get_by_label('Mot de passe',exact=True).fill('Migration@2026:')
        await page.get_by_role('button',name='Accéder à mon espace').click()
        await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
        result = await page.evaluate('''async () => {
          const m = await import('/src/web/lib/database.ts');
          const s = await m.snapshot();
          if(s.transactions.length!==1 || s.transactions[0].special || s.settings.pozzolanaCapacity!==48 || s.plans[0].pozzolana!==7 || s.users.length!==3) throw Error('Migration data mismatch');
          const t={...s.transactions[0],special:true};
          await m.restoreBackup({...s,version:1,ops:undefined,transactions:[t]});
          if((await m.db.transactions.get(t.atc)).special) throw Error('v1 manual flag restored');
          let blocked=false;
          try {const imp=await import('/src/web/lib/importing.ts');await imp.commitImport({filename:'DDS'},undefined);} catch {blocked=true;}
          if(!blocked) throw Error('Standalone import permitted');
          return {migration:true,customPasswordPreserved:true,plansPreserved:true,settingsPreserved:true,v1Backup:true,ddsOnlyBlocked:true};
        }''')
        print(json.dumps(result))
        await browser.close()

asyncio.run(run())