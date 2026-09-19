const{ipcRenderer}=require('electron')
ipcRenderer.once('opensaddle-application-port',event=>window.postMessage('opensaddle-application-port','*',event.ports))
