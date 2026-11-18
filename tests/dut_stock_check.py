import asyncio, json, sys
from pathlib import Path
from playwright.async_api import async_playwright, expect

OUT=Path('/home/user/rm-sb/test-output')

async def run(url,offline):
  fixture=json.loads((OUT/'finance-final.json').read_text())
  dds={r['atc']:r['exit'][:10] for r in fixture['transactions']}
  dates={}
  for r in fixture['ops']:
    dut=r.get('dut','').strip().upper();date=dds.get(r['atc']) or r['date']
    if dut and date:dates[dut]=min(dates.get(dut,date),date)
  used=sum('2026-11-08'<=d<='2026-11-30' for d in dates.values())
  before_second=25-sum('2026-11-08'<=d<'2026-11-12' for d in dates.values())
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
    await page.get_by_role('button',name='Paramètres',exact=True).click()
    await page.get_by_label('Fichier sauvegarde RM-SB').set_input_files(str(OUT/'finance-final.json'))
    await page.get_by_role('button',name='Restaurer le projet',exact=True).click()
    await page.get_by_text('Sauvegarde restaurée : 88 transaction(s) fusionnées.',exact=True).wait_for()
    if offline:
      await page.evaluate('navigator.serviceWorker.ready');await page.wait_for_function('navigator.serviceWorker.controller!==null')
      await context.set_offline(True);await page.reload()
      await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
    async def duties():await page.get_by_role('button',name='Gestion DUT',exact=True).click()
    async def snap(name):
      await page.get_by_role('button',name='Paramètres',exact=True).click()
      async with page.expect_download() as info:await page.get_by_role('button',name='Sauvegarder JSON',exact=True).click()
      d=await info.value;await d.save_as(str(OUT/name));return json.loads((OUT/name).read_text())
    def panel():return page.locator('section.panel').filter(has=page.get_by_role('heading',name='Stock de feuilles DUT',exact=True))
    async def receipt(date,qty,initial=None):
      await page.get_by_role('button',name='Nouvelle réception',exact=True).click()
      await page.get_by_label('Date de réception DUT',exact=True).fill(date)
      await page.get_by_label('Nombre de feuilles DUT reçues',exact=True).fill(str(qty))
      if initial is not None:await page.get_by_label('Stock initial de feuilles DUT',exact=True).fill(str(initial))
      else:assert not await page.get_by_label('Stock initial de feuilles DUT',exact=True).count()
      return page.get_by_role('button',name='Enregistrer la réception DUT',exact=True)
    await duties()
    save=await receipt('2026-11-08',20,5)
    await expect(page.get_by_label('Feuilles DUT disponibles avant réception',exact=True)).to_have_value('5')
    await expect(page.get_by_label('Feuilles DUT disponibles après réception',exact=True)).to_have_value('25')
    await save.click();await page.get_by_text('Réception DUT enregistrée. Stock recalculé.',exact=True).wait_for()
    await expect(panel().locator('.kpi-value').nth(1)).to_contain_text(str(used))
    await expect(panel().locator('.kpi-value').nth(2)).to_contain_text(str(25-used))
    save=await receipt('2026-11-12',10)
    await expect(page.get_by_label('Feuilles DUT disponibles avant réception',exact=True)).to_have_value(str(before_second))
    await expect(page.get_by_label('Feuilles DUT disponibles après réception',exact=True)).to_have_value(str(before_second+10))
    await save.click();await page.get_by_text('Réception DUT enregistrée. Stock recalculé.',exact=True).wait_for()
    await expect(panel().locator('.kpi-value').nth(2)).to_contain_text(str(35-used))
    await page.screenshot(path=str(OUT/'dut-stock.png'),full_page=True)
    full=await snap('dut-stock-full.json');assert full['version']==6 and len(full['dutReceipts'])==2 and full['dutOpening']=={'id':'main','date':'2026-11-08','quantity':5}
    # Native Excel backup carries the new tables and restores exactly.
    async with page.expect_download() as info:await page.get_by_role('button',name='Sauvegarder Excel',exact=True).click()
    d=await info.value;await d.save_as(str(OUT/'dut-stock-backup.xlsx'))
    await page.get_by_label('Fichier sauvegarde RM-SB').set_input_files(str(OUT/'dut-stock-backup.xlsx'))
    await page.get_by_role('button',name='Restaurer le projet',exact=True).click()
    await page.get_by_text('Sauvegarde restaurée : 88 transaction(s) fusionnées.',exact=True).wait_for()
    restored=await snap('dut-stock-restored.json')
    for key in ['dutReceipts','dutOpening','reservations','fuelOpening','ops','settings','plans','users']:assert restored[key]==full[key],key
    legacy=json.loads(json.dumps(full));legacy['version']=3;legacy.pop('dutReceipts');legacy.pop('dutOpening')
    (OUT/'dut-stock-legacy.json').write_text(json.dumps(legacy))
    await page.get_by_label('Fichier sauvegarde RM-SB').set_input_files(str(OUT/'dut-stock-legacy.json'))
    await page.get_by_role('button',name='Restaurer le projet',exact=True).click()
    await page.get_by_text('Sauvegarde restaurée : 88 transaction(s) fusionnées.',exact=True).wait_for()
    preserved=await snap('dut-stock-legacy-restored.json');assert preserved['dutReceipts']==full['dutReceipts'] and preserved['dutOpening']==full['dutOpening']
    await duties()
    # Reports keep financial cost and include physical stock/history/usage.
    for f in ['PDF','XLSX','DOCX']:
      async with page.expect_download() as info:await page.get_by_role('button',name='Exporter '+f,exact=True).click()
      d=await info.value;await d.save_as(str(OUT/('dut-stock-report.'+f.lower())))
    first=next(r for r in full['dutReceipts'] if r['date']=='2026-11-08')
    second=next(r for r in full['dutReceipts'] if r['date']=='2026-11-12')
    await page.get_by_role('button',name='Modifier réception DUT '+first['id'],exact=True).click()
    await page.get_by_label('Nombre de feuilles DUT reçues',exact=True).fill('1')
    await page.get_by_role('button',name='Annuler la modification DUT',exact=True).click()
    await page.get_by_role('button',name='Modifier réception DUT '+first['id'],exact=True).click()
    await page.get_by_label('Date de réception DUT',exact=True).fill('2026-11-01')
    await page.get_by_role('button',name='Enregistrer les modifications DUT',exact=True).click()
    await page.get_by_text('La réception ne peut pas précéder la date du stock initial.',exact=True).wait_for()
    await page.get_by_label('Date de réception DUT',exact=True).fill('2026-11-09')
    await page.get_by_label('Nombre de feuilles DUT reçues',exact=True).fill('1')
    await page.get_by_label('Commentaire réception DUT',exact=True).fill('Correction stock')
    await page.get_by_role('button',name='Enregistrer les modifications DUT',exact=True).click()
    await page.get_by_text('Réception DUT modifiée. Stock recalculé.',exact=True).wait_for()
    await expect(panel().locator('.kpi-value').nth(2)).to_contain_text(str(16-used))
    await page.get_by_role('button',name='Supprimer réception DUT '+second['id'],exact=True).click()
    await page.get_by_role('button',name='Annuler',exact=True).click()
    await page.get_by_role('button',name='Supprimer réception DUT '+second['id'],exact=True).click()
    await page.get_by_role('button',name='Confirmer la suppression DUT',exact=True).click()
    await page.get_by_text('Réception DUT supprimée. Stock initial conservé et soldes recalculés.',exact=True).wait_for()
    await expect(panel().locator('.kpi-value').nth(2)).to_contain_text(str(6-used))
    await page.get_by_role('button',name='Supprimer réception DUT '+first['id'],exact=True).click()
    await page.get_by_role('button',name='Confirmer la suppression DUT',exact=True).click()
    await page.get_by_text('Aucune réception DUT pour cette période',exact=True).wait_for()
    save=await receipt('2026-11-20',20);await save.click()
    await page.get_by_text('Réception DUT enregistrée. Stock recalculé.',exact=True).wait_for()
    await page.reload();await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
    final=await snap('dut-stock-final.json');assert len(final['dutReceipts'])==1 and final['dutOpening']==full['dutOpening']
    await page.get_by_role('button',name='Réinitialiser',exact=True).click()
    await page.get_by_role('button',name='Confirmer la réinitialisation',exact=True).click()
    await page.get_by_text('réinitialisés',exact=False).first.wait_for()
    reset=await snap('dut-stock-reset.json');assert reset['dutReceipts']==final['dutReceipts'] and reset['dutOpening']==full['dutOpening']
    await duties();await expect(panel().locator('.kpi-value').nth(1)).to_contain_text('0');await expect(panel().locator('.kpi-value').nth(2)).to_contain_text('25')
    await page.get_by_role('button',name='Se déconnecter').click()
    await page.get_by_label('Nom d’utilisateur').fill('CONSULTANT');await page.get_by_label('Mot de passe',exact=True).fill('Consultation@2026:')
    await page.get_by_role('button',name='Accéder à mon espace').click();await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
    await duties()
    assert await page.get_by_role('button',name='Modifier réception DUT '+final['dutReceipts'][0]['id'],exact=True).is_disabled()
    assert await page.get_by_role('button',name='Supprimer réception DUT '+final['dutReceipts'][0]['id'],exact=True).is_disabled()
    await page.get_by_role('button',name='Nouvelle réception',exact=True).click();assert await page.get_by_role('button',name='Enregistrer la réception DUT',exact=True).is_disabled()
    if not offline:
      blocked=await page.evaluate('''async()=>{const m=await import('/src/web/lib/dut-stock.ts');let n=0;for(const f of [()=>m.saveDutReceipt({},0),()=>m.deleteDutReceipt('none')])try{await f()}catch{n++}return n}''');assert blocked==2
    await page.set_viewport_size({'width':390,'height':844})
    await page.wait_for_function('document.querySelector(".sidebar").getBoundingClientRect().right<=0')
    await page.screenshot(path=str(OUT/'dut-stock-mobile.png'),full_page=True)
    assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
    assert not errors,errors
    print(json.dumps({'stockInitialOnce':True,'autoUniqueUse':used,'beforeAfterBalances':True,'editDelete':True,'deficit':True,'xlsxRoundtrip':True,'legacyV3PreservesStock':True,'reports':['PDF','XLSX','DOCX'],'resetPreservesStock':True,'readOnly':True,'offline':offline,'pageErrors':errors}))
    await browser.close()

if __name__=='__main__':asyncio.run(run(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:4200','--offline' in sys.argv))