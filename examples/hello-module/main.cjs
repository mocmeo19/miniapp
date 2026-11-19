exports.activate = ({ handle, settings }) => {
  handle('greet', (_event, payload) => {
    const name = typeof payload === 'string' ? payload.trim().slice(0, 60) : ''
    const count = settings.get('greeting-count', 0) + 1
    settings.set('greeting-count', count)
    return { text: `Hello, ${name || 'friend'}!`, count }
  })
}
