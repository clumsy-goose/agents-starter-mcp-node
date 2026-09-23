import GitHubLink from './components/GitHubLink';
import DeployLink from './components/DeployLink';
import Home from './components/Home/Home';
import { I18nProvider } from './i18n';

/**
 * App shell.
 *
 * The homepage has been redesigned: it now presents the project title,
 * the Agent routes and the MCP configuration (including a live /mcp
 * health check) instead of the chat UI. The chat / sidebar / code viewer
 * components remain in src/components/ but are no longer mounted here.
 */
export default function App() {
  return (
    <I18nProvider>
      <Home />
      <GitHubLink />
      <DeployLink />
    </I18nProvider>
  );
}
