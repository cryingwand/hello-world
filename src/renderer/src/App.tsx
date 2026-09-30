import { APP_NAME } from '@shared/app-info'

export default function App(): React.JSX.Element {
  return (
    <div className="boot">
      <h1>{APP_NAME}</h1>
      <p>Scaffold running on {window.api.platform}.</p>
    </div>
  )
}
