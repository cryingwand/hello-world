import type { AppProps } from '../types'
import FilesApp from '../files/FilesApp'

export default function LibraryApp(props: AppProps): React.JSX.Element {
  return <FilesApp {...props} scope="library" />
}
