// Toast minimal en DOM pur — signature : toast(message, 'success' | 'error')

let container: HTMLDivElement | null = null

function getContainer(): HTMLDivElement {
  if (!container || !document.body.contains(container)) {
    container = document.createElement('div')
    container.className = 'toast-container'
    document.body.appendChild(container)
  }
  return container
}

export function toast(message: string, type: 'success' | 'error' = 'success') {
  const el = document.createElement('div')
  el.className = `toast${type === 'error' ? ' error' : ''}`
  el.textContent = message
  getContainer().appendChild(el)
  setTimeout(() => {
    el.classList.add('fade-out')
    setTimeout(() => el.remove(), 450)
  }, 3500)
}
