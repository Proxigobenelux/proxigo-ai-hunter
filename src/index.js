import { createClient } from '@supabase/supabase-js';
import { fetchTED } from './sources/ted.js';
import { fetchBOAMP } from './sources/boamp.js';
import { fetchBelgium } from './sources/belgium-rss.js';
import { fetchTenderNed } from './sources/tendernet.js';
import { fetchLuxembourg } from './sources/luxembourg.js';
import { log } from './logger.js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const INTERVAL = parseInt(process.env.CRON_INTERVAL_MS??'14400000');
async function upsert(items) {
  let n=0;
  for (const item of items) {
    const {error} = await supabase.from('opportunities').upsert(item,{onConflict:'external_id',ignoreDuplicates:true});
    if (!error) n++;
  }
  return n;
}
async function run() {
  log('info','Hunter','Démarrage — 5 sources');
  let total=0;
  for (const [name,fn] of [['TED',fetchTED],['BOAMP',fetchBOAMP],['Belgique',fetchBelgium],['TenderNed',fetchTenderNed],['Luxembourg',fetchLuxembourg]]) {
    try { const items=await fn(); const n=await upsert(items); log('info',name,`${n} insérées`,{found:items.length}); total+=n; }
    catch(e){ log('error',name,e.message); }
  }
  log('info','Hunter',`Terminé — ${total} nouvelles`);
}
run();
setInterval(run, INTERVAL);
