import json, os
from pathlib import Path
from opensaddle.codex_app_server import CodexAppServerManager
from opensaddle.control_plane.native_worker import OutboundCodexWorkerExecutor
from opensaddle.control_plane.worker_client import OutboundWorkerClient, OutboundWorkerClientConfig
from opensaddle.control_plane.worker_loop import FencedWorkerLoop
from opensaddle.storage.runtime_store import RuntimeStore
root=Path(os.environ['OPENSADDLE_NATIVE_EVIDENCE_DIR']).resolve(); meta=json.loads((root/'fixture.json').read_text()); credential=Path(meta['worker_credential_path']).read_text().strip()
manager=CodexAppServerManager(command=(os.environ.get('CODEX_EXECUTABLE','codex'),'-c','model="gpt-5.6-sol"','app-server','--stdio'),isolate_process_group=False,request_timeout=30)
with OutboundWorkerClient(OutboundWorkerClientConfig(meta['base_url'],meta['worker_id'],credential).validate()) as client, RuntimeStore(root/'worker-runtime.db') as store:
 client.heartbeat(); executor=OutboundCodexWorkerExecutor(client,manager,store,workspace=Path(meta['workspace']))
 try:
  result=FencedWorkerLoop(client,executor).run_once(); print(json.dumps({'claimed':result.claimed,'status':result.status,'run_id':result.run_id,'fenced':result.fenced}))
 finally: executor.close()
