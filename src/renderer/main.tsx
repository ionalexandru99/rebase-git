import { render } from 'solid-js/web'
import './index.css'
import App from './App'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

render(() => <App />, rootElement)
