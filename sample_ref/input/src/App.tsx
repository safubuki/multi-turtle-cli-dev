/**
 * @file App.tsx
 * @author Turtle Village
 */
import TurtleVideo from './components/TurtleVideo';
import ErrorBoundary from './components/common/ErrorBoundary';




import { useOrientationLock } from './hooks/useOrientationLock';
import { useAutoSave } from './hooks/useAutoSave';

import { ReloadPrompt } from './components/ReloadPrompt';

function App() {
  // 可能な限り縦画面に固定を試みる（スマホ対策）
  useOrientationLock('portrait');

  // 自動保存機能（2分間隔）
  useAutoSave();

  return (
    <ErrorBoundary>
      <TurtleVideo />
      <ReloadPrompt />
    </ErrorBoundary>
  );
}

export default App;
