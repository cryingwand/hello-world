import type { AppProps } from '../types'
import FilesApp from '../files/FilesApp'

export default function VaultFilesApp(props: AppProps): React.JSX.Element {
  return <FilesApp {...props} scope="vault" />
}
