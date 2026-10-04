"""Owned offline runtime; no account, network or global settings access."""
import importlib.util,json,sys
from pathlib import Path
root=Path(sys.argv[1]);home=root/'native-home';home.mkdir()
(home/'settings.yaml').write_text('bundle:\n  app: []\n')
module=root/'provider/amplifier_module_provider_headless_fixture';module.mkdir(parents=True)
(module.parent/'pyproject.toml').write_text('[project]\nname="amplifier-module-provider-headless-fixture"\nversion="0.1.0"\n')
(module/'__init__.py').write_text('''import json
from pathlib import Path
from amplifier_core.models import ProviderInfo
from amplifier_core.message_models import ChatResponse,TextBlock,Usage
class Provider:
    name='fixture'
    def __init__(self,config):self.config=config
    def get_info(self):return ProviderInfo(id='fixture',display_name='Offline headless',defaults={'model':'first-model','max_tokens':4096},capabilities=[])
    def parse_tool_calls(self,response):return []
    async def list_models(self):return [{'id':'first-model'},{'id':'second-model'}]
    async def complete(self,request,**kwargs):
        with Path(self.config['audit']).open('a') as f:f.write(json.dumps({'model':request.model,'effort':request.reasoning_effort,'bundle':self.config['bundle']})+'\\n')
        return ChatResponse(content=[TextBlock(text='Offline reply: '+str(request.model))],finish_reason='stop',usage=Usage(input_tokens=8,output_tokens=5,total_tokens=13))
async def mount(coordinator,config=None):await coordinator.mount('providers',Provider(config or {}),name='configured-instance')
''')
context=Path(importlib.util.find_spec('amplifier_module_context_simple').origin).parent
for name in ['default','chosen']:
    (root/(name+'.yaml')).write_text('bundle:\n  name: '+name+'\n  version: 1.0.0\nsession:\n  orchestrator:\n    module: loop-live\n  context:\n    module: context-simple\n    source: '+str(context)+'\nproviders:\n  - module: provider-headless-fixture\n    instance_id: configured-instance\n    source: '+str(module.parent)+'\n    config: '+json.dumps({'audit':str(root/'provider-audit.jsonl'),'bundle':name})+'\n')
(root/'native.json').write_text(json.dumps({'home':str(home),'appHome':str(root/'native-app'),'registryHome':str(root/'registry'),'bundle':str(root/'default.yaml'),'forkBundles':{'work':str(root/'chosen.yaml')},'managedSessionRoots':[str(root/'managed')],'moduleSources':{key:str(Path(importlib.util.find_spec(name).origin).parent) for key,name in [('loop-live','amplifier_module_loop_live'),('hook-context-intelligence','amplifier_module_hook_context_intelligence')]},'runtimeImmutable':True,'startupTimeout':90}))
