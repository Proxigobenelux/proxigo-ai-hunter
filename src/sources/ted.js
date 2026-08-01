import fetch from 'node-fetch';
import { log } from '../logger.js';
const BASE = 'https://ted.europa.eu/api/v3.0/notices/search';
const KEYWORDS = ['nettoyage','plomberie','électricité','jardinage','maintenance'];
export async function fetchTED() {
  const results = [];
  try {
    for (const kw of KEYWORDS.slice(0,4)) {
      const res = await fetch(`${BASE}?fields=ND,TI,AC,PC,DT,DL&q=CONTENT:[${kw}]&pageSize=10&page=1`,{headers:{Accept:'application/json'}});
      if (!res.ok) continue;
      const json = await res.json();
      for (const n of json?.results ?? []) {
        const id = n.ND?.[0]; if (!id) continue;
        results.push({ title: n.TI?.[0]??'Appel d\'offres TED', description: n.AC?.[0]??'', source_name:'TED Europe', source_url:`https://ted.europa.eu/udl?uri=TED:NOTICE:${id}:TEXT:FR:HTML`, organism:n.AC?.[0]??'', category:'Multi-services', country:n.PC?.[0]??'EU', deadline:n.DL?.[0]??null, external_id:`ted-${id}`, type:'public', status:'active' });
      }
    }
  } catch(e){ log('error','TED',e.message); }
  return results;
}
