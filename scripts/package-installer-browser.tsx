/** Presentation fixture: no runtime, publisher trust, package installation or execution. */
import React from 'react'
import {createRoot} from 'react-dom/client'
import {PersonalPackageInstaller} from '../src/features/settings/PersonalPackageInstaller'
import {PersonalCatalogClient} from '../src/services/personalCatalog'
import '../src/styles/app.css'
import '../src/features/command-center/command-center.css'
document.body.style.overflow='auto'
createRoot(document.getElementById('root')!).render(<main style={{width:600,maxWidth:'100%',margin:'40px auto',padding:24}}><h1>Personal views</h1><p>Presentation preview · no connected runtime</p><PersonalPackageInstaller client={new PersonalCatalogClient('/unavailable-preview',()=> 'preview')} onInstalled={()=>{}}/></main>)
