import asyncio, json, sys
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path('/home/user/rm-sb/test-output')
FIXTURE = OUT/'reset-fixture.json'
data = json.loads((OUT/'ops-first.json').read_text())
data['plans'] = [{'date':'2026-11-02','pozzolana':7,'granite':2}]
data['settings']['pozzolanaCapacity'] = 48
FIXTURE.write_text(json.dumps(data))

async def run(url, offline=False):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width':1440,'height':1080},accept_downloads=True)
        page = await context.new_page()
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        await page.goto(url)
        async def login(role,password):
            await page.get_by_label('Nom d’utilisateur').fill(role)
            await page.get_by_label('Mot de passe',exact=True).fill(password)
            await page.get_by_role('button',name='Accéder à mon espace').click()
            await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
            await page.get_by_role('button',name='Paramètres',exact=True).click()
        async def snapshot(name):
            async with page.expect_download() as info:
                await page.get_by_role('button',name='Sauvegarder JSON',exact=True).click()
            d=await info.value
            path=OUT/name
            await d.save_as(str(path))
            return json.loads(path.read_text())
        await login('ADMIN','Logistics@2026:')
        await page.get_by_label('Fichier sauvegarde RM-SB').set_input_files(str(FIXTURE))
        await page.get_by_role('button',name='Restaurer le projet',exact=True).click()
        await page.get_by_text('Sauvegarde restaurée : 88 transaction(s) fusionnées.',exact=True).wait_for()
        await page.get_by_role('button',name='Réinitialiser',exact=True).click()
        await page.get_by_role('dialog',name='Réinitialiser tous les imports ?').wait_for()
        await page.get_by_role('button',name='Annuler',exact=True).click()
        before=await snapshot('reset-before.json')
        assert len(before['transactions'])==88 and len(before['ops'])==22 and before['imports']
        for role,password in [('SUPERVISER','Logistics@2026:'),('CONSULTANT','Consultation@2026:')]:
            await page.get_by_role('button',name='Se déconnecter').click()
            await login(role,password)
            assert not await page.get_by_role('button',name='Réinitialiser',exact=True).count()
            if url.endswith(':4200'):
                blocked=await page.evaluate('''async()=>{const m=await import('/src/web/lib/database.ts');try{await m.resetImports();return false;}catch{return true;}}''')
                assert blocked
        await page.get_by_role('button',name='Se déconnecter').click()
        await login('ADMIN','Logistics@2026:')
        if offline:
            await page.evaluate('navigator.serviceWorker.ready')
            await page.wait_for_function('navigator.serviceWorker.controller!==null')
            await context.set_offline(True)
            await page.reload()
            await page.get_by_role('button',name='Paramètres',exact=True).click()
        await page.get_by_role('button',name='Réinitialiser',exact=True).click()
        await page.screenshot(path=str(OUT/'reset-confirmation.png'),full_page=True)
        await page.get_by_role('button',name='Confirmer la réinitialisation',exact=True).click()
        await page.get_by_text('Imports réinitialisés :',exact=False).wait_for()
        after=await snapshot('reset-after.json')
        assert after['transactions']==[] and after['ops']==[] and after['imports']==[]
        for key in ['users','settings','plans']: assert before[key]==after[key],key
        await page.reload()
        await page.get_by_role('button',name='Paramètres',exact=True).click()
        persisted=await snapshot('reset-reloaded.json')
        assert persisted['transactions']==[] and persisted['ops']==[] and persisted['imports']==[]
        await page.get_by_role('button',name='Import DDS',exact=True).click()
        await page.get_by_label('Fichier extraction DDS',exact=True).set_input_files('/home/user/Attachments/EXTRACTION_A_PRENDRE_EN_COMPTE_Npa9yv.xls')
        await page.wait_for_function('!document.querySelector("#file-ops").disabled')
        await page.get_by_label('Fichier extraction Ops Spe',exact=True).set_input_files('/home/user/Attachments/EXTRACTION_A_PRENDRE_EN_COMPTE_POUR_LES_OPERATIONS_SPECIALES_0QN-EB.xlsx')
        await page.get_by_role('button',name='Analyser les deux fichiers').click()
        await page.get_by_role('button',name='Confirmer l’import des deux fichiers').click()
        await page.get_by_text('88 transaction(s) importée(s). 0 doublon(s) ignoré(s). Correspondance Ops Spe actualisée.',exact=True).wait_for()
        await page.get_by_role('button',name='Paramètres',exact=True).click()
        restored=await snapshot('reset-reimport.json')
        assert len(restored['transactions'])==88 and len(restored['ops'])==22 and len(restored['imports'])==1
        assert not errors,errors
        print(json.dumps({'adminOnly':True,'cancellation':True,'resetAllImports':True,'usersSettingsPlansPreserved':True,'persistentAfterReload':True,'reimportAfterReset':True,'offline':offline,'pageErrors':errors}))
        await browser.close()

asyncio.run(run(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:4200','--offline' in sys.argv))