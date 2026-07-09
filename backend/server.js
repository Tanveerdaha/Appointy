import 'dotenv/config'
import { createApp, initServices } from './app.js'

const port = process.env.PORT || 4000

await initServices()
const app = createApp()

app.listen(port, () => console.log(`Server started on PORT:${port}`))
