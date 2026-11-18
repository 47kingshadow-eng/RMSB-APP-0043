import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright

async def run():
 fixture=json.loads(Path('/home/user/rm-sb/test-output/finance-final.json').read_text())
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
  page=await b.new_page();await page.goto('http://localhost:4200');await page.get_by_role('heading',name='Connexion à RM-SB').wait_for()
  await page.evaluate('''async backup=>{
   const m=await import('/src/web/lib/database.ts');await m.db.delete();
   const request=indexedDB.open('RM-SB',30);
   const schema={transactions:['atc','exit','product','transporter'],ops:['atc','date'],plans:['date'],settings:['id'],users:['name'],imports:['id','date'],reservations:['id','number','date'],fuelOpening:['id']};
   request.onupgradeneeded=()=>{for(const [name,[key,...indices]] of Object.entries(schema)){const s=request.result.createObjectStore(name,{keyPath:key});for(const index of indices)s.createIndex(index,index,{unique:index==='number'});}};
   const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
   const tx=db.transaction(Object.keys(schema),'readwrite');
   for(const name of ['transactions','ops','plans','users','imports','reservations'])backup[name].forEach(r=>tx.objectStore(name).put(r));
   tx.objectStore('settings').put(backup.settings);tx.objectStore('fuelOpening').put(backup.fuelOpening);
   await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
  }''',fixture)
  await page.reload();await page.get_by_label('Mot de passe',exact=True).fill('Logistics@2026:');await page.get_by_role('button',name='Accéder à mon espace').click();await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
  snapshot=await page.evaluate('async()=>await(await import("/src/web/lib/database.ts")).snapshot()')
  for key in ['transactions','ops','plans','settings','users','imports','reservations','fuelOpening']:assert snapshot[key]==fixture[key],key
  assert snapshot['version']==6 and snapshot['dutReceipts']==[] and snapshot['dutOpening'] is None
  print(json.dumps({'v3ToV4Migration':True,'allExistingDataPreserved':True,'passwordLogin':True,'dutStockStartsEmpty':True}));await b.close()
asyncio.run(run())