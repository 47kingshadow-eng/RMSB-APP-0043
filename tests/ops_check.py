import asyncio, csv, json, sys
from pathlib import Path
import xlrd
from playwright.async_api import async_playwright

ROOT = Path('/home/user/rm-sb')
OUT = ROOT/'test-output'
DDS = '/home/user/Attachments/EXTRACTION_A_PRENDRE_EN_COMPTE_Npa9yv.xls'
OPS = '/home/user/Attachments/EXTRACTION_A_PRENDRE_EN_COMPTE_POUR_LES_OPERATIONS_SPECIALES_0QN-EB.xlsx'

def write_csv(name, rows):
    path = OUT/name
    with path.open('w', newline='') as f: csv.writer(f).writerows(rows)
    return str(path)

async def run(url, offline):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await browser.new_context(viewport={'width':1440,'height':1080}, accept_downloads=True)
        page = await ctx.new_page()
        page.set_default_timeout(60000)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(url)
        await page.get_by_label('Mot de passe', exact=True).fill('Logistics@2026:')
        await page.get_by_role('button', name='Accéder à mon espace').click()
        await page.get_by_role('heading', name='Tableau de bord', exact=True).wait_for()
        await page.get_by_label('Date de début').fill('2026-11-01')
        await page.get_by_label('Date de fin').fill('2026-11-30')

        async def pair(dds, ops):
            await page.get_by_role('button', name='Import DDS', exact=True).click()
            analyze = page.get_by_role('button', name='Analyser les deux fichiers')
            assert await analyze.is_disabled()
            await page.get_by_label('Fichier extraction DDS', exact=True).set_input_files(dds)
            await page.get_by_role('button', name='Importer Ops Spe', exact=True).wait_for(state='visible')
            await page.wait_for_function('!document.querySelector("#file-ops").disabled')
            assert await analyze.is_disabled(), 'DDS alone must not permit import'
            await page.get_by_label('Fichier extraction Ops Spe', exact=True).set_input_files(ops)
            await analyze.click()
            await page.get_by_role('button', name='Confirmer l’import des deux fichiers').wait_for()
            assert not await page.locator('.error-box').count(), await page.locator('.error-box').all_text_contents()
            await page.screenshot(path=str(OUT/'paired-preview.png'), full_page=True)
            await page.get_by_role('button', name='Confirmer l’import des deux fichiers').click()
            await page.get_by_text('Correspondance Ops Spe actualisée.', exact=False).wait_for()
            await page.get_by_role('button', name='Fermer la notification', exact=True).click()
            assert await analyze.is_disabled(), 'Both files must be supplied again'

        async def snapshot(name):
            await page.get_by_role('button', name='Paramètres', exact=True).click()
            async with page.expect_download() as info:
                await page.get_by_role('button', name='Sauvegarder JSON', exact=True).click()
            d = await info.value
            path = OUT/name
            await d.save_as(str(path))
            return json.loads(path.read_text())

        await pair(DDS, OPS)
        first = await snapshot('ops-first.json')
        assert len(first['transactions']) == 88
        assert len(first['ops']) == 22
        assert sum(t['special'] for t in first['transactions']) == 22
        assert sum(not t['special'] and t['transporter']=='DANTRANS' for t in first['transactions']) == 14
        assert round(sum(t['net'] for t in first['transactions']), 2) == 3988.62
        await pair(DDS, OPS)
        second = await snapshot('ops-reimport.json')
        assert len(second['transactions']) == 88 and len(second['ops']) == 22
        latest = max(second['imports'], key=lambda i: i['date'])
        assert latest['accepted'] == 0 and latest['duplicates'] == 88
        await page.get_by_role('button', name='Correspondance Ops Spe', exact=True).click()
        await page.get_by_role('heading', name='Correspondance Ops Spe', exact=True).wait_for()
        await page.screenshot(path=str(OUT/'ops-matching.png'), full_page=True)
        assert await page.get_by_text('Manquant DDS', exact=True).count() == 1 # option only
        await page.get_by_role('button', name='Transactions', exact=False).filter(has=page.locator('small')).click()
        assert not await page.get_by_role('checkbox').count()
        assert not await page.get_by_role('button', name='Affecter à Opération Spéciale', exact=True).count()

        # An existing external transporter becomes special; repeated official ATC is deduplicated.
        external = next(t['atc'] for t in first['transactions'] if t['transporter']!='DANTRANS')
        correction = write_csv('ops-correction.csv', [['N° ATC WB','Date'],[external,'2026-11-03'],[external,'2026-11-03'],['9999999999','2026-11-03']])
        await pair(DDS, correction)
        await page.get_by_role('button', name='Correspondance Ops Spe', exact=True).click()
        await page.get_by_label('Statut de correspondance').select_option('Manquant DDS')
        await page.get_by_text('9999999999', exact=True).wait_for()
        correction_snapshot = await snapshot('ops-correction.json')
        assert len(correction_snapshot['ops']) == 24
        assert next(t for t in correction_snapshot['transactions'] if t['atc']==external)['special']

        # Fresh month with empty official list does not erase previous month's references.
        source = xlrd.open_workbook(DDS).sheet_by_index(0)
        fresh = [source.row_values(0)]
        for atc, transporter in [('9999999999','DANTRANS'),('9999999998',' dantrans '),('9999999997','TEST TRANSPORTER')]:
            row = source.row_values(1)
            row[1],row[2],row[3],row[9] = '12/01/2026 08:00:00','12/01/2026 09:00:00',atc,transporter
            fresh.append(row)
        new_dds = write_csv('dds-december.csv',fresh)
        empty_ops = write_csv('ops-december.csv',[['N° ATC WB','Date']])
        if offline:
            await page.evaluate('navigator.serviceWorker.ready')
            await page.wait_for_function('navigator.serviceWorker.controller !== null')
            assert await page.evaluate('caches.keys()')
            await ctx.set_offline(True)
            await page.reload()
            await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
            await page.get_by_text('Hors connexion',exact=True).wait_for()
        await pair(new_dds, empty_ops)
        final = await snapshot('ops-final.json')
        assert len(final['transactions']) == 91 and len(final['ops']) == 24
        assert next(t for t in final['transactions'] if t['atc']=='9999999999')['special']
        assert not next(t for t in final['transactions'] if t['atc']=='9999999998')['special']
        assert len([t for t in final['transactions'] if t['exit'].startswith('2026-11')]) == 88
        await page.get_by_label('Date de fin').fill('2026-12-31')
        await page.get_by_role('button',name='Correspondance Ops Spe',exact=True).click()
        await page.get_by_label('Statut de correspondance').select_option('Manquant DDS')
        await page.get_by_text('Aucune correspondance pour ces filtres',exact=True).wait_for()

        # Backup roundtrip includes references; exports work locally.
        await page.get_by_role('button',name='Paramètres',exact=True).click()
        async with page.expect_download() as info:
            await page.get_by_role('button',name='Sauvegarder Excel',exact=True).click()
        d = await info.value
        await d.save_as(str(OUT/'ops-backup.xlsx'))
        await page.get_by_label('Fichier sauvegarde RM-SB').set_input_files(str(OUT/'ops-backup.xlsx'))
        await page.get_by_role('button',name='Restaurer le projet',exact=True).click()
        await page.get_by_text('Sauvegarde restaurée : 91 transaction(s) fusionnées.',exact=True).wait_for()
        restored = await snapshot('ops-restored.json')
        assert len(restored['ops']) == 24 and sum(t['special'] for t in restored['transactions']) == 24
        await page.get_by_role('button',name='Rapports',exact=True).click()
        for format in ['PDF','XLSX','DOCX']:
            async with page.expect_download() as info:
                await page.get_by_role('button',name='Exporter '+format,exact=True).click()
            d = await info.value
            await d.save_as(str(OUT/('ops-report.'+format.lower())))
        if offline: await ctx.set_offline(False)
        await page.get_by_role('button',name='Se déconnecter').click()
        await page.get_by_label('Nom d’utilisateur').fill('CONSULTANT')
        await page.get_by_label('Mot de passe',exact=True).fill('Consultation@2026:')
        await page.get_by_role('button',name='Accéder à mon espace').click()
        await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
        await page.get_by_role('button',name='Import DDS',exact=True).click()
        assert await page.get_by_role('button',name='Importer DDS',exact=True).is_disabled()
        assert await page.get_by_role('button',name='Importer Ops Spe',exact=True).is_disabled()
        await page.set_viewport_size({'width':390,'height':844})
        await page.wait_for_function('document.querySelector(".sidebar").getBoundingClientRect().right <= 0')
        await page.screenshot(path=str(OUT/'ops-mobile.png'),full_page=True)
        assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert not errors, errors
        print(json.dumps({'realPair':{'dds':88,'tonnage':3988.62,'special':22,'reverse':14,'thirdParty':52},'monthlyHistory':True,'dedup':True,'missingResolved':True,'xlsxRestore':True,'offline':offline,'pageErrors':errors}))
        await browser.close()

if __name__=='__main__':
    asyncio.run(run(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:4200','--offline' in sys.argv))