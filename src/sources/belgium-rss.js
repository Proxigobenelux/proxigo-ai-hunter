import RSSParser from 'rss-parser';
import { log } from '../logger.js';
const parser = new RSSParser();
export async function fetchBelgium() {
  const results = [];
  try {
    const feed = await parser.parseURL('https://www.publicprocurement.be/fr/rss/notices');
    for (const item of (feed.items??[]).slice(0,30)) {
      const id=item.guid??item.link; if(!id) continue;
      results.push({ title:item.title??'Marché public belge', description:item.contentSnippet??'', source_name:'e-Procurement Belgique', source_url:item.link??'', organism:item.creator??'', category:'Multi-services', country:'BE', deadline:item.pubDate?new Date(new Date(item.pubDate).getTime()+30*864e5).toISOString():null, external_id:`be-${Buffer.from(id).toString('base64').slice(0,32)}`, type:'public', status:'active' });
    }
  } catch(e){ log('error','Belgium',e.message); }
  return results;
}
