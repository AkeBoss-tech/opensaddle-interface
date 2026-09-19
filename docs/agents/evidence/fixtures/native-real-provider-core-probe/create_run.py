import json,os,urllib.request
from pathlib import Path
root=Path(os.environ['OPENSADDLE_NATIVE_EVIDENCE_DIR']).resolve();meta=json.loads((root/'fixture.json').read_text());token=Path(meta['member_token_path']).read_text().strip()
body={'project_id':meta['project_id'],'source_id':meta['source_id'],'task':'Read FACT.txt in the configured workspace. Return exactly the fact token after the colon, with no explanation or punctuation.'}
req=urllib.request.Request(meta['base_url']+'/api/v2/runs',data=json.dumps(body).encode(),method='POST',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'});result=json.loads(urllib.request.urlopen(req).read());(root/'run.json').write_text(json.dumps({'run_id':result['run_id']})+'\n');print(result['run_id'])
