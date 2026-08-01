import fetch from 'node-fetch';
import { log } from '../logger.js';
const CAT={schoonmaak:'Nettoyage',loodgieter:'Plomberie',elektra:'Électricité',tuin:'Jardinage',verhuiz:'Déménagement',schilder:'Peinture',bouw:'Maçonnerie',timmer:'Menuiserie',installatie:'Chauffage/HVAC',beveiliging:'Sécurité',dak:'Toiture',ict:'Informatique'};
function detectCategory(t=''){const l=t.toLowerCase();for(const[k,v]of Object.entries(CAT))if(l.includes(k))return v;return 'Multi-services';}
export async function fetchTenderNed() {
  const results = [];
  try {
    const res = await fetch('https://www.tenderned.nl/api/publieksportaal/aanbestedingen?page=0&size=30&sort=publicatieDatum,desc',{headers:{Accept:'application/json','User-Agent':'ProxigoAIHunter/1.0'}});
    if (!res.ok) return results;
    const json = await res.json();
    for (const item of json?.content??json?.aanbestedingen??[]) {
      const id=item.id??item.kenmerk; if(!id) continue;
      const title=item.omschrijving??item.naam??'Aanbesteding NL';
      results.push({ title, description:item.omschrijving??'', source_name:'TenderNed Pays-Bas', source_url:`https://www.tenderned.nl/aankondigingen/overzicht/${id}`, organism:item.aanbestedendeDienst?.naam??'', category:detectCategory(title), country:'NL', city:item.gemeente??'', deadline:item.sluitingsDatum??null, external_id:`nl-${id}`, type:'public', status:'active' });
    }
  } catch(e){ log('error','TenderNed',e.message); }
  return results;
}
