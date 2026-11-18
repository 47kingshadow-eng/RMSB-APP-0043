import asyncio, json, csv, sys
from pathlib import Path
from playwright.async_api import async_playwright

OUT=Path('/home/user/rm-sb/test-output')
DDS='/home/user/Attachments/EXTRACTION_A_PRENDRE_EN_COMPTE_Npa9yv.xls'
OPS='/home/user/Attachments/EXTRACTION_A_PRENDRE_EN_COMPTE_POUR_LES_OPERATIONS_SPECIALES_0QN-EB.xlsx'

async def run(url,offline):
  async with async_playwright() as pw:
    browser=await pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    context=await browser.new_context(viewport={'width':1440,'height':1080},accept_downloads=True)
    page=await context.new_page();page.set_default_timeout(60000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    await page.goto(url)
    await page.get_by_label('Mot de passe',exact=True).fill('Logistics@2026:')
    await page.get_by_role('button',name='Accéder à mon espace').click()
    await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
    await page.get_by_label('Date de début').fill('2026-11-01');await page.get_by_label('Date de fin').fill('2026-11-30')
    async def pair(ops):
      await page.get_by_role('button',name='Import DDS',exact=True).click()
      await page.get_by_label('Fichier extraction DDS',exact=True).set_input_files(DDS)
      await page.wait_for_function('!document.querySelector("#file-ops").disabled')
      await page.get_by_label('Fichier extraction Ops Spe',exact=True).set_input_files(ops)
      await page.get_by_role('button',name='Analyser les deux fichiers').click()
      await page.get_by_role('button',name='Confirmer l’import des deux fichiers').click()
      await page.get_by_text('Correspondance Ops Spe actualisée.',exact=False).wait_for()
      await page.get_by_role('button',name='Fermer la notification',exact=True).click()
    async def snapshot(name):
      await page.get_by_role('button',name='Paramètres',exact=True).click()
      async with page.expect_download() as info:await page.get_by_role('button',name='Sauvegarder JSON',exact=True).click()
      d=await info.value;await d.save_as(str(OUT/name));return json.loads((OUT/name).read_text())
    await pair(OPS)
    initial=await snapshot('finance-initial.json')
    assert len(set(r['dut'] for r in initial['ops']))==22
    assert initial['version']==6 and initial['settings']['dutPrice']==2500
    await page.get_by_role('button',name='Gestion DUT',exact=True).click()
    await page.screenshot(path=str(OUT/'dut.png'),full_page=True)
    await page.get_by_text('55 000',exact=False).first.wait_for()
    for format in ['PDF','XLSX','DOCX']:
      async with page.expect_download() as info:await page.get_by_role('button',name='Exporter '+format,exact=True).click()
      d=await info.value;await d.save_as(str(OUT/('dut-report.'+format.lower())))
    await page.get_by_role('button',name='Gestion Carburant',exact=True).click()
    async def reserve(number,date,qty,initial=False):
      await page.get_by_role('button',name='Nouvelle Réservation',exact=True).click()
      await page.get_by_label('Date et heure de réservation',exact=True).fill(date)
      await page.get_by_label('N° Réservation',exact=True).fill(number)
      await page.get_by_label('Quantité réservée (L)',exact=True).fill(qty)
      if initial:await page.get_by_label('Stock initial disponible (L)',exact=True).fill('500')
      else:assert not await page.get_by_label('Stock initial disponible (L)',exact=True).count()
      await page.get_by_label('Nb rotations Pouzzolane',exact=True).fill('10')
      await page.get_by_label('Nb rotations Granite',exact=True).fill('5')
      await page.get_by_text('2 910',exact=False).first.wait_for()
      await page.get_by_role('button',name='Enregistrer la réservation',exact=True).click()
      await page.get_by_text('Réservation carburant enregistrée. FIFO et solde recalculés.',exact=True).wait_for()
      await page.get_by_role('button',name='Fermer la notification',exact=True).click()
    await reserve('RES-001','2026-11-03T15:00','3000',True)
    await reserve('RES-002','2026-11-08T15:00','1000')
    await page.get_by_role('button',name='Stock Carburant',exact=True).click()
    assert not await page.locator('.error-box').count()
    await page.screenshot(path=str(OUT/'fuel-stock.png'),full_page=True)
    await page.get_by_role('button',name='Nouvelle Réservation',exact=True).click()
    await page.get_by_label('N° Réservation',exact=True).fill('RES-002')
    await page.get_by_label('Quantité réservée (L)',exact=True).fill('100')
    await page.get_by_role('button',name='Enregistrer la réservation',exact=True).click()
    await page.get_by_text('Ce numéro de réservation existe déjà.',exact=True).wait_for()
    # New month-week calendar, comments and grouped Excel layout.
    await page.get_by_role('button',name='Planification',exact=True).click()
    await page.get_by_label('Semaine de planification',exact=True).select_option('3')
    await page.get_by_role('heading',name='WEEK 3 - NOVEMBER 2026',exact=True).wait_for()
    await page.get_by_label('pozzolana 2026-11-15 camions',exact=True).fill('10')
    await page.get_by_label('granite 2026-11-16 camions',exact=True).fill('5')
    await page.get_by_label('Comments / Actions 2026-11-15',exact=True).fill('Panne : action corrective')
    await page.get_by_role('button',name='Enregistrer les objectifs',exact=True).click()
    await page.get_by_text('Objectifs et commentaires hebdomadaires enregistrés.',exact=True).wait_for()
    await page.screenshot(path=str(OUT/'direction-planning.png'),full_page=True)
    async with page.expect_download() as info:await page.get_by_role('button',name='Exporter planning Excel',exact=True).click()
    d=await info.value;await d.save_as(str(OUT/'direction-planning.xlsx'))
    await page.get_by_label('Mois de planification',exact=True).select_option('12')
    await page.get_by_role('heading',name='WEEK 1 - DECEMBER 2026',exact=True).wait_for()
    await page.get_by_label('pozzolana 2026-12-01 camions',exact=True).wait_for()
    assert not await page.get_by_label('pozzolana 2026-11-29 camions',exact=True).count()
    await page.get_by_label('Mois de planification',exact=True).select_option('11')
    await page.get_by_label('Semaine de planification',exact=True).select_option('3')
    assert await page.get_by_label('Comments / Actions 2026-11-15',exact=True).input_value()=='Panne : action corrective'
    await page.get_by_role('button',name='Paramètres',exact=True).click()
    await page.get_by_label('Date d’effet',exact=True).fill('2026-11-01')
    await page.get_by_label('Prix unitaire DUT',exact=True).fill('3000')
    await page.get_by_role('button',name='Enregistrer les paramètres',exact=True).click()
    await page.get_by_text('Paramètres enregistrés',exact=False).first.wait_for()
    await page.get_by_role('button',name='Fermer la notification',exact=True).click()
    # Two missing DDS ATCs share one official DUT: count once, even unmatched.
    more=OUT/'dut-shared.csv'
    with more.open('w',newline='') as f:csv.writer(f).writerows([['N° ATC WB','Date','DUT N°UNIQUE'],['9990000001','2026-11-16','DUT SHARED'],['9990000002','2026-11-16',' dut shared ']])
    await pair(str(more))
    await page.get_by_role('button',name='Gestion DUT',exact=True).click()
    await page.get_by_text('69 000',exact=False).first.wait_for()
    await page.get_by_label('Rechercher DUT ou ATC',exact=True).fill('DUT SHARED')
    row=page.get_by_role('row').filter(has_text='DUT SHARED')
    assert await row.count()==1
    final=await snapshot('finance-final.json')
    assert len(final['reservations'])==2 and final['fuelOpening']['quantity']==500
    assert len(set(r['dut'] for r in final['ops'] if r['dut']))==23
    assert next(p for p in final['plans'] if p['date']=='2026-11-15')['comment']=='Panne : action corrective'
    async with page.expect_download() as info:await page.get_by_role('button',name='Sauvegarder Excel',exact=True).click()
    d=await info.value;await d.save_as(str(OUT/'finance-backup.xlsx'))
    await page.get_by_label('Fichier sauvegarde RM-SB').set_input_files(str(OUT/'finance-backup.xlsx'))
    await page.get_by_role('button',name='Restaurer le projet',exact=True).click()
    await page.get_by_text('Sauvegarde restaurée : 88 transaction(s) fusionnées.',exact=True).wait_for()
    restored=await snapshot('finance-restored.json')
    for key in ['reservations','fuelOpening','ops','plans','settings']:assert restored[key]==final[key],key
    legacy=json.loads(json.dumps(final));legacy['version']=2
    legacy.pop('reservations');legacy.pop('fuelOpening')
    legacy['settings'].pop('dutPrice');legacy['settings'].pop('dutCurrency')
    for r in legacy['ops']:r.pop('dut',None)
    for p in legacy['plans']:p.pop('comment',None)
    (OUT/'finance-legacy.json').write_text(json.dumps(legacy))
    await page.get_by_label('Fichier sauvegarde RM-SB').set_input_files(str(OUT/'finance-legacy.json'))
    await page.get_by_role('button',name='Restaurer le projet',exact=True).click()
    await page.get_by_text('Sauvegarde restaurée : 88 transaction(s) fusionnées.',exact=True).wait_for()
    legacy_restored=await snapshot('finance-legacy-restored.json')
    for key in ['reservations','fuelOpening','ops','plans','settings']:assert legacy_restored[key]==final[key],key
    if offline:
      await page.evaluate('navigator.serviceWorker.ready');await page.wait_for_function('navigator.serviceWorker.controller!==null')
      await context.set_offline(True);await page.reload()
      await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
      await page.get_by_text('Hors connexion',exact=True).wait_for()
      await page.get_by_role('button',name='Gestion Carburant',exact=True).click()
      await reserve('RES-003','2026-11-20T15:00','100')
    await page.get_by_role('button',name='Gestion Carburant',exact=True).click()
    await page.get_by_role('button',name='Rapports Carburant',exact=True).click()
    for format in ['PDF','XLSX','DOCX']:
      async with page.expect_download() as info:await page.get_by_role('button',name='Exporter '+format,exact=True).click()
      d=await info.value;await d.save_as(str(OUT/('fuel-report.'+format.lower())))
    if offline:await context.set_offline(False)
    if url.endswith(':4200'):
      result=await page.evaluate('''async()=>{const m=await import('/src/web/lib/operations.ts');const d=await import('/src/web/lib/database.ts');const snap=await d.snapshot();const l=m.fuelLedger(snap.reservations,snap.fuelOpening,snap.transactions,snap.settings);if(l.consumed!==4400||l.balance!==100||l.uncovered!==0)throw Error(JSON.stringify(l));return {consumed:l.consumed,balance:l.balance,lots:l.lots.map(v=>({number:v.number,consumed:v.consumed,remaining:v.remaining}))};}''')
      print('LEDGER',json.dumps(result))
    before_reset=await snapshot('finance-before-reset.json')
    await page.get_by_role('button',name='Réinitialiser',exact=True).click()
    await page.get_by_role('button',name='Confirmer la réinitialisation',exact=True).click()
    await page.get_by_text('réinitialisés',exact=False).first.wait_for()
    after_reset=await snapshot('finance-after-reset.json')
    for key in ['reservations','fuelOpening','plans','settings','users']:assert after_reset[key]==before_reset[key],key
    for key in ['transactions','ops','imports']:assert after_reset[key]==[],key
    await page.get_by_role('button',name='Gestion Carburant',exact=True).click()
    await page.get_by_role('button',name='Stock Carburant',exact=True).click()
    assert not await page.locator('.error-box').count()
    await page.get_by_role('button',name='Se déconnecter').click()
    await page.get_by_label('Nom d’utilisateur').fill('CONSULTANT');await page.get_by_label('Mot de passe',exact=True).fill('Consultation@2026:')
    await page.get_by_role('button',name='Accéder à mon espace').click();await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
    await page.get_by_role('button',name='Gestion Carburant',exact=True).click();await page.get_by_role('button',name='Nouvelle Réservation',exact=True).click()
    assert await page.get_by_role('button',name='Enregistrer la réservation',exact=True).is_disabled()
    await page.set_viewport_size({'width':390,'height':844})
    await page.wait_for_function('document.querySelector(".sidebar").getBoundingClientRect().right<=0')
    await page.screenshot(path=str(OUT/'finance-mobile.png'),full_page=True)
    assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
    assert not errors,errors
    print(json.dumps({'realDUT':22,'uniqueWithSharedMissing':23,'fuelFIFO':True,'stockInitialOnce':True,'directionCalendar':True,'comments':True,'priceRecalculation':True,'xlsxRoundtrip':True,'legacyRestorePreservesNewFields':True,'resetPreservesFuel':True,'exports':['pdf','xlsx','docx'],'offline':offline,'pageErrors':errors}))
    await browser.close()

if __name__=='__main__':asyncio.run(run(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:4200','--offline' in sys.argv))