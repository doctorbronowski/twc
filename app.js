import('./server/index.ts').catch((error) => {
  console.error('Unable to start TWC application:', error)
  process.exit(1)
})
