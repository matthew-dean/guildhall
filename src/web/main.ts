import { mount } from 'svelte'
import App from './App.svelte'
import './tokens.css'

const target = document.getElementById('svelte-root')
if (!target) {
  throw new Error('[guildhall web] #svelte-root mount point not found in shell HTML')
}

mount(App, { target })
