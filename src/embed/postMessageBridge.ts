import { BoundingBox, SimulationConfig, FrameStats } from '../core/types';
import { useFloodStore } from '../ui/store/useFloodStore';

export interface IframeInMessage {
  type: 'setArea' | 'setConfig' | 'run' | 'play' | 'pause' | 'reset' | 'setInflows';
  bounds?: BoundingBox;
  config?: Partial<SimulationConfig>;
  inflows?: any[];
}

export interface IframeOutMessage {
  source: 'FloodSim';
  type: 'ready' | 'progress' | 'finished' | 'error';
  payload?: any;
  stats?: FrameStats;
  error?: string;
}

/**
 * Initialize postMessage bridge for iframe embedding.
 * Listens to parent window commands and posts updates back.
 */
export function initPostMessageBridge(): () => void {
  const handleMessage = async (event: MessageEvent) => {
    // Basic sanity check
    if (!event.data || typeof event.data !== 'object') return;

    const data = event.data as IframeInMessage;
    const store = useFloodStore.getState();

    switch (data.type) {
      case 'setArea':
        if (data.bounds) {
          store.setBounds(data.bounds);
          await store.loadTerrainForBounds(data.bounds, store.config.gridSize);
        }
        break;

      case 'setConfig':
        if (data.config) {
          store.updateConfig(data.config);
        }
        break;

      case 'setInflows':
        if (data.inflows) {
          store.setInflows(data.inflows);
        }
        break;

      case 'run':
        store.startSimulation();
        break;

      case 'play':
        store.play();
        break;

      case 'pause':
        store.pause();
        break;

      case 'reset':
        store.resetSimulation();
        break;
    }
  };

  window.addEventListener('message', handleMessage);

  // Notify parent window that FloodSim is initialized and ready
  sendToParent({
    source: 'FloodSim',
    type: 'ready',
    payload: { version: '2.0.0', status: 'ready' },
  });

  // Subscribe to store updates to broadcast progress and finished events
  const unsub = useFloodStore.subscribe((state, prevState) => {
    // Progress
    if (state.status === 'simulating' && state.progressPercent !== prevState.progressPercent) {
      sendToParent({
        source: 'FloodSim',
        type: 'progress',
        payload: {
          percent: state.progressPercent,
          stage: state.progressStage,
        },
      });
    }

    // Finished
    if (state.status === 'finished' && prevState.status !== 'finished') {
      const lastFrame = state.frames[state.frames.length - 1];
      sendToParent({
        source: 'FloodSim',
        type: 'finished',
        stats: lastFrame?.stats,
        payload: {
          summaryJson: state.exportSummaryJson(),
          geoJson: state.exportGeoJsonFile(),
        },
      });
    }

    // Error
    if (state.status === 'error' && state.errorMessage && state.errorMessage !== prevState.errorMessage) {
      sendToParent({
        source: 'FloodSim',
        type: 'error',
        error: state.errorMessage,
      });
    }
  });

  return () => {
    window.removeEventListener('message', handleMessage);
    unsub();
  };
}

function sendToParent(msg: IframeOutMessage) {
  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    window.parent.postMessage(msg, '*');
  }
}
