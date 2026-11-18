import asyncio,json
from playwright.async_api import async_playwright

async def run():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
  page=await b.new_page();await page.goto('http://localhost:4200');await page.get_by_role('heading',name='Connexion à RM-SB').wait_for()
  result=await page.evaluate('''async()=>{
   const {dutStockLedger:l,saveDutReceipt}=await import('/src/web/lib/dut-stock.ts');
   const d=await import('/src/web/lib/database.ts');const assert=(v,m)=>{if(!v)throw Error(m)};
   const r=(id,date,quantity)=>({id,date,quantity,comment:'',createdBy:'ADMIN',createdAt:'2026-11-01T00:00:00Z'});
   const refs=[{atc:'OLD1',dut:'SHARED OLD',date:'2026-11-01'},{atc:'OLD2',dut:'shared old',date:'2026-11-12'}, {atc:'NEW1',dut:' SHARED ',date:'2026-11-08'},{atc:'NEW2',dut:'shared',date:'2026-12-01'},{atc:'MISSING',dut:'MISSING DDS',date:'2026-11-09'},{atc:'DDS',dut:'DDS DATE',date:'2026-11-01'},{atc:'UNKNOWN',dut:'NO DATE',date:''},{atc:'BLANK',dut:'',date:'2026-11-09'}];
   const rows=[{atc:'DDS',exit:'2026-11-10T15:00:00Z'}],opening={id:'main',date:'2026-11-08',quantity:5};
   const receipts=[r('R1','2026-11-08',20),r('R2','2026-11-09',10),r('R3','2026-12-01',100)];
   let s=l(receipts,opening,refs,rows,'2026-11-30');
   assert(s.used===3&&s.received===30&&s.available===32,'Unique stock including missing DDS and DDS date priority');
   assert(s.unknown.length===1&&s.excludedBeforeStart===1,'Unknown dates/earlier shared DUT');
   assert(s.history[0].before===5&&s.history[0].after===25&&s.history[1].before===24&&s.history[1].after===34,'Balances before daily usage');
   assert(l(receipts,opening,refs,rows,'2026-12-31').used===3,'Shared DUT crossing periods never charged again');
   assert(l(receipts,opening,refs,rows,'2026-11-07').available===0,'Future opening and receipts excluded');
   assert(l([],null,refs,rows).used===0,'No stock initialized');
   const sameDay=l([r('a','2026-11-08',1),r('b','2026-11-08',2)],opening,refs,rows,'2026-11-08');assert(sameDay.history[1].before===6&&sameDay.available===7,'Multiple same-day receipts');
   const deficit=l([r('a','2026-11-08',1),r('b','2026-11-12',10)],{...opening,quantity:0},refs,rows,'2026-11-30');assert(deficit.historicalDeficit===2&&deficit.available===8,'Historical deficit kept after replenishment');
   await d.initialize();await d.useSession.getState().login('ADMIN','Logistics@2026:');
   let blocked=0;for(const quantity of [-1,0,1.5])try{await saveDutReceipt({date:'2026-11-08',quantity,comment:''},0)}catch{blocked++}assert(blocked===3,'Quantity validates positive integer');
   return {uniqueAcrossATCsAndPeriods:true,missingDDSIncluded:true,unknownDateNotDeducted:true,priorDUTExcluded:true,beforeAfterSameDay:true,historicalDeficit:true,integerValidation:true};
  }''');print(json.dumps(result));await b.close()
asyncio.run(run())