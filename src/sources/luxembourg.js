import RSSParser from 'rss-parser';
import fetch from 'node-fetch';
import { log } from '../logger.js';
const parser = new RSSParser();
export async function fetchLuxembourg() {
  const results = [];
  try {
    const feed = await parser.parseURL('https://www.marches-publics.lu/rss/avis');
    for (const item of (feed.items??[]).slice(0,20)) {
      const id=item.guid??item.link; if(!id) continue;
      results.push({ title:item.title??'Marché public Luxembourg', description:item.contentSnippet??'', source_name:'Marchés Publics Luxembourg', source_url:item.link??'', organism:item.creator??'', category:'Multi-services', country:'LU', deadline:item.pubDate?new Date(new Date(item.pubDate).getTime()+30*864e5).toISOString():null, external_id:`lu-${Buffer.from(id).toString('base64').slice(0,32)}`, type:'public', status:'active' });
    }
  } catch {
    try {
      const res = await fetch('https://ted.europa.eu/api/v3.0/notices/search?fields=ND,TI,AC,DL&q=PC%3ALU&pageSize=20&page=1',{headers:{Accept:'application/json'}});
      if (!res.ok) return results;
      const json = await res.json();
      for (const n of json?.results??[]) {
        const id=n.ND?.[0]; if(!id) continue;
        results.push({ title:n.TI?.[0]??'Appel d\'offres Luxembourg', description:'', source_name:'TED Luxembourg', source_url:`https://ted.europa.eu/udl?uri=TED:NOTICE:${id}:TEXT:FR:HTML`, organism:n.AC?.[0]??'', category:'Multi-services', country:'LU', deadline:n.DL?.[0]??null, external_id:`lu-${id}`, type:'public', status:'active' });
      }
    } catch(e){ log('error','Luxembourg',e.message); }
  }
  return results;
}
