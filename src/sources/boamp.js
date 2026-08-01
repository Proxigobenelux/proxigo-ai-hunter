import fetch from 'node-fetch';
import { log } from '../logger.js';
const BASE = 'https://www.boamp.fr/api/explore/v2.1/catalog/datasets/boamp/records';
const CAT = { nettoyage:'Nettoyage',plomberie:'Plomberie',electricite:'Électricité',jardinage:'Jardinage',demenagement:'Déménagement',peinture:'Peinture',maconnerie:'Maçonnerie',menuiserie:'Menuiserie',chauffage:'Chauffage/HVAC',securite:'Sécurité',toiture:'Toiture',informatique:'Informatique' };
function detectCategory(t=''){const l=t.toLowerCase();for(const[k,v]of Object.entries(CAT))if(l.includes(k))return v;return 'Multi-services';}
export async function fetchBOAMP() {
  const results = [];
  try {
    const res = await fetch(`${BASE}?limit=50&order_by=dateparution%20DESC&where=famille%3D%22AAPC%22`,{headers:{Accept:'application/json'}});
    if (!res.ok) return results;
    const json = await res.json();
    for (const f of json.results??[]) {
      const id=f.idweb??f.reference??f.numero_annonce; if(!id) continue;
      const title=f.objet??f.intitule??'Appel d\'offres BOAMP';
      results.push({ title, description:f.descriptif??'', source_name:'BOAMP France', source_url:`https://www.boamp.fr/avis/detail/${id}`, organism:f.acheteur?.nom??'', category:detectCategory(title), country:'FR', city:f.departement_publication??'', deadline:f.date_limite??null, external_id:`boamp-${id}`, type:'public', status:'active' });
    }
  } catch(e){ log('error','BOAMP',e.message); }
  return results;
}
