import asyncio, json, sys
from pathlib import Path
from playwright.async_api import async_playwright, expect

OUT = Path('/home/user/rm-sb/test-output')

async def run(url, offline):
  async with async_playwright() as pw:
    browser = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    context = await browser.new_context(viewport={'width':1440,'height':1080}, accept_downloads=True)
    page = await context.new_page(); page.set_default_timeout(60000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    await page.goto(url)
    await page.get_by_label('Mot de passe',exact=True).fill('Logistics@2026:')
    await page.get_by_role('button',name='Accéder à mon espace').click()
    await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
    await page.get_by_label('Date de début').fill('2026-11-01')
    await page.get_by_label('Date de fin').fill('2026-11-30')
    await page.get_by_role('button',name='Paramètres',exact=True).click()
    await page.get_by_label('Fichier sauvegarde RM-SB').set_input_files(str(OUT/'finance-final.json'))
    await page.get_by_role('button',name='Restaurer le projet',exact=True).click()
    await page.get_by_text('Sauvegarde restaurée : 88 transaction(s) fusionnées.',exact=True).wait_for()
    if offline:
      await page.evaluate('navigator.serviceWorker.ready')
      await page.wait_for_function('navigator.serviceWorker.controller!==null')
      await context.set_offline(True);await page.reload()
      await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
    async def history():
      await page.get_by_role('button',name='Gestion Carburant',exact=True).click()
      await page.get_by_role('button',name='Historique des Réservations',exact=True).click()
    async def snapshot():
      await page.get_by_role('button',name='Paramètres',exact=True).click()
      async with page.expect_download() as info:
        await page.get_by_role('button',name='Sauvegarder JSON',exact=True).click()
      download=await info.value
      path=OUT/('edit-snapshot-offline.json' if offline else 'edit-snapshot.json')
      await download.save_as(str(path));return json.loads(path.read_text())
    baseline=await snapshot();await history()
    await page.get_by_role('button',name='Modifier RES-001',exact=True).click()
    await expect(page.get_by_label('Quantité réservée (L)',exact=True)).to_have_value('3000')
    await page.get_by_label('Quantité réservée (L)',exact=True).fill('500')
    await page.get_by_role('button',name='Annuler la modification',exact=True).click()
    cancelled=await snapshot();assert cancelled['reservations']==baseline['reservations']
    await history();await page.get_by_role('button',name='Modifier RES-001',exact=True).click()
    await page.get_by_label('N° Réservation',exact=True).fill('RES-002')
    await page.get_by_role('button',name='Enregistrer les modifications',exact=True).click()
    await page.get_by_text('Ce numéro de réservation existe déjà.',exact=True).wait_for()
    await page.get_by_label('N° Réservation',exact=True).fill('RES-EDIT')
    await page.get_by_label('Date et heure de réservation',exact=True).fill('2026-11-01T15:00')
    await page.get_by_role('button',name='Enregistrer les modifications',exact=True).click()
    await page.get_by_text('La réservation ne peut pas précéder la date du stock initial.',exact=True).wait_for()
    await page.get_by_label('Date et heure de réservation',exact=True).fill('2026-11-09T15:00:01')
    await page.get_by_label('Quantité réservée (L)',exact=True).fill('500')
    await page.get_by_label('Nb rotations Pouzzolane',exact=True).fill('2')
    await page.get_by_label('Nb rotations Granite',exact=True).fill('3')
    await page.get_by_label('Commentaire réservation',exact=True).fill('Correction validée')
    await page.get_by_role('button',name='Enregistrer les modifications',exact=True).click()
    await page.get_by_text('Réservation modifiée. FIFO et solde recalculés.',exact=True).wait_for()
    await expect(page.locator('.kpi-value').nth(2)).to_contain_text('-2 400')
    edited=await snapshot()
    original=next(r for r in baseline['reservations'] if r['number']=='RES-001')
    record=next(r for r in edited['reservations'] if r['number']=='RES-EDIT')
    assert record['id']==original['id'] and record['createdAt']==original['createdAt'] and record['createdBy']==original['createdBy']
    assert record['quantity']==500 and record['pozzolana']==2 and record['granite']==3 and record['comment']=='Correction validée'
    assert record['date']=='2026-11-09T15:00:01.000Z' and edited['fuelOpening']==baseline['fuelOpening']
    if not offline:
      result=await page.evaluate('''async()=>{const d=await import('/src/web/lib/database.ts');const m=await import('/src/web/lib/operations.ts');const s=await d.snapshot();const l=m.fuelLedger(s.reservations,s.fuelOpening,s.transactions,s.settings);if(l.balance!==-2400||l.uncovered!==2400)throw Error(JSON.stringify(l));return l.uncovered}''')
      assert result==2400
    await history()
    await page.screenshot(path=str(OUT/('reservation-actions-offline.png' if offline else 'reservation-actions.png')),full_page=True)
    await page.get_by_role('button',name='Supprimer RES-002',exact=True).click()
    await page.get_by_role('button',name='Annuler',exact=True).click()
    cancelled=await snapshot();assert cancelled['reservations']==edited['reservations']
    await history();await page.get_by_role('button',name='Supprimer RES-002',exact=True).click()
    await page.get_by_role('button',name='Confirmer la suppression',exact=True).click()
    await page.get_by_text('Réservation supprimée. FIFO et solde recalculés ; stock initial conservé.',exact=True).wait_for()
    await expect(page.locator('.kpi-value').nth(2)).to_contain_text('-3 400')
    await page.get_by_role('button',name='Supprimer RES-EDIT',exact=True).click()
    await page.get_by_role('button',name='Confirmer la suppression',exact=True).click()
    await page.get_by_text('Aucune réservation pour cette période',exact=True).wait_for()
    deleted=await snapshot();assert deleted['reservations']==[] and deleted['fuelOpening']==baseline['fuelOpening']
    assert deleted['transactions']==baseline['transactions'] and deleted['ops']==baseline['ops']
    await history();await page.get_by_role('button',name='Nouvelle Réservation',exact=True).click()
    assert not await page.get_by_label('Stock initial disponible (L)',exact=True).count()
    await page.get_by_label('Date et heure de réservation',exact=True).fill('2026-11-20T15:00')
    await page.get_by_label('N° Réservation',exact=True).fill('RES-AFTER')
    await page.get_by_label('Quantité réservée (L)',exact=True).fill('100')
    await page.get_by_role('button',name='Enregistrer la réservation',exact=True).click()
    await page.get_by_text('Réservation carburant enregistrée. FIFO et solde recalculés.',exact=True).wait_for()
    await page.reload();await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
    persisted=await snapshot();assert persisted['reservations'][0]['number']=='RES-AFTER' and persisted['fuelOpening']==baseline['fuelOpening']
    await page.get_by_role('button',name='Se déconnecter').click()
    await page.get_by_label('Nom d’utilisateur').fill('CONSULTANT')
    await page.get_by_label('Mot de passe',exact=True).fill('Consultation@2026:')
    await page.get_by_role('button',name='Accéder à mon espace').click()
    await page.get_by_role('heading',name='Tableau de bord',exact=True).wait_for()
    await history()
    assert await page.get_by_role('button',name='Modifier RES-AFTER',exact=True).is_disabled()
    assert await page.get_by_role('button',name='Supprimer RES-AFTER',exact=True).is_disabled()
    if not offline:
      blocked=await page.evaluate('''async()=>{const m=await import('/src/web/lib/operations.ts');let blocked=0;for(const f of [()=>m.updateReservation('fake',{}),()=>m.deleteReservation('fake')])try{await f()}catch{blocked++}return blocked}''');assert blocked==2
    await page.set_viewport_size({'width':390,'height':844})
    await page.wait_for_function('document.querySelector(".sidebar").getBoundingClientRect().right<=0')
    assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
    assert not errors, errors
    print(json.dumps({'editAllFields':True,'duplicateBlocked':True,'initialDateProtected':True,'cancelEdit':True,'cancelDelete':True,'fifoRecalculated':True,'deleteLastKeepsInitialStock':True,'persistence':True,'consultantBlocked':True,'offline':offline,'pageErrors':errors}))
    await browser.close()

if __name__=='__main__':
  asyncio.run(run(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:4200','--offline' in sys.argv))