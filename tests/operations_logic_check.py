import asyncio, json
from playwright.async_api import async_playwright

async def run():
  async with async_playwright() as pw:
    browser=await pw.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    page=await browser.new_page()
    await page.goto('http://localhost:4200')
    await page.get_by_role('heading',name='Connexion à RM-SB').wait_for()
    result=await page.evaluate('''async()=>{
      const m=await import('/src/web/lib/operations.ts');const d=await import('/src/web/lib/database.ts');
      const assert=(v,msg)=>{if(!v)throw Error(msg);};
      const r=(id,date,quantity)=>({id,number:id,date,quantity,pozzolana:0,granite:0,comment:'',createdBy:'ADMIN',createdAt:date});
      const t=(atc,exit,product='POUZZOLANE',special=true)=>({atc,exit,product,special,net:45});
      const reserves=[r('R1','2026-11-16T15:00:00.000Z',100),r('R2','2026-11-17T15:00:00.000Z',500)];
      const opening={id:'main',date:reserves[0].date,quantity:50};
      const rows=[t('BEFORE','2026-11-16T14:59:59Z'),t('EQUAL','2026-11-16T15:00:00Z'),t('A','2026-11-16T15:00:01Z'),t('B','2026-11-17T15:00:00Z','GRANITE'),t('C','2026-11-17T15:00:01Z','GRANITE'),t('C','2026-11-17T15:00:01Z','GRANITE'),t('THIRD','2026-11-17T16:00:00Z','GRANITE',false)];
      const l=m.fuelLedger(reserves,opening,rows,d.defaults);
      assert(l.consumption.length===3,'Eligibility / duplicates');assert(l.consumed===564,'Consumption');assert(l.uncovered===232,'Uncovered');assert(l.balance===86,'Net balance');
      assert(l.consumption[0].allocations.length===2&&l.consumption[0].uncovered===50,'FIFO split');assert(l.consumption[1].allocations.length===0,'Strict equal date second reservation');assert(l.lots.find(v=>v.id==='R2').consumed===182,'No retroactive coverage');
      const cut=m.fuelLedger(reserves,opening,rows,d.defaults,'2026-11-16T23:59:59Z');assert(cut.reserved===100&&cut.balance===-50,'Future deposits excluded / deficit');
      assert(m.monthWeekStart('2026-11',3)==='2026-11-15','November example');assert(m.monthWeekStart('2026-12',1)==='2026-11-29','Month spillover');assert(m.monthWeekStart('2027-01',1)==='2026-12-27','Year spillover');
      for(let y=2024;y<=2028;y++)for(let mo=1;mo<=12;mo++){
        const month=`${y}-${String(mo).padStart(2,'0')}`,first=m.monthWeekStart(month,1),last=new Date(Date.UTC(y,mo,0)).toISOString().slice(0,10);
        assert(new Date(first+'T12:00:00Z').getUTCDay()===0,'Sunday start');assert(first<=month+'-01'&&d.plusDays(first,6)>=month+'-01','Week 1 contains 1st');assert(m.monthWeeks(month)>=4&&m.monthWeeks(month)<=6,'Valid weeks');assert(m.monthWeekStart(month,m.monthWeeks(month))<=last&&d.plusDays(m.monthWeekStart(month,m.monthWeeks(month)),6)>=last,'Last day covered');
      }
      const refs=[{atc:'1',dut:' DUT000125 ',date:'2026-11-16'},{atc:'2',dut:'dut000125',date:'2026-11-16'},{atc:'3',dut:'DUT000125',date:'2026-11-16'},{atc:'4',dut:'DUT000126',date:'2026-11-16'},{atc:'5',dut:'',date:'2026-11-16'}];
      const dut=m.dutSummary(refs,[], '2026-11-01','2026-11-30');assert(dut.groups.length===2&&dut.references===5&&dut.matched===0&&dut.missingDut===1,'DUT unique / missing DDS / blank');
      const w=m.weeklyMetrics([{date:'2026-11-16',pozzolana:10,granite:5,comment:'Test'}],[t('W1','2026-11-16T16:00:00Z'),t('W2','2026-11-16T16:00:00Z','GRANITE')],d.defaults);
      assert(w[0].products[0].plannedTonnage===500&&w[0].products[0].actualRotations===1&&w[0].products[0].actualTonnage===45&&w[0].products[1].plannedTonnage===250,'Planning metrics');
      return {strictDateBoundary:true,initialFIFO:true,splitFIFO:true,noDoubleConsumption:true,noRetroactiveCoverage:true,negativeBalance:true,calendarMonths:60,dutUniqueIncludingMissing:true,planningMetrics:true};
    }''')
    print(json.dumps(result));await browser.close()

asyncio.run(run())