type BlackmiJson = null | boolean | number | string | readonly BlackmiJson[] | BlackmiObject;
interface BlackmiObject {
  readonly [key: string]: BlackmiJson;
}

type BlackmiDispose = () => void;
type BlackmiRole = '' | 'host' | 'guest';
type BlackmiGamePhase = 'play' | 'end' | 'aborted';

interface BlackmiRoomStatus {
  label: string;
  [key: string]: BlackmiJson;
}

interface BlackmiAppContext {
  readonly id: string;
  readonly root: HTMLElement;
  isActive(): boolean;
  listen<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void, options?: boolean | AddEventListenerOptions): BlackmiDispose;
  listen(target: EventTarget, type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): BlackmiDispose;
  onFrame(callback: (now: number, dt: number) => void): BlackmiDispose;
  onRender(callback: (now: number) => void): Readonly<{ invalidate(): void; dispose: BlackmiDispose }>;
  cleanup(callback: BlackmiDispose): BlackmiDispose;
  on(event: string, callback: (data: BlackmiJson) => void): BlackmiDispose;
  emit(event: string, data?: BlackmiJson): void;
  onNetwork(callback: (status: BlackmiRoomStatus) => void): BlackmiDispose;
  onTheme(callback: (theme: 'light' | 'dark') => void): BlackmiDispose;
  notify(title: string, message: string): void;
  storage: Readonly<{
    get<T extends BlackmiJson>(key: string, fallback: T): T;
    get(key: string): BlackmiJson | undefined;
    set(key: string, value: BlackmiJson): void;
    remove(key: string): void;
  }>;
  network: Readonly<{
    getStatus(): BlackmiRoomStatus;
    capabilities(): { roomStatus: true; gameData: false; reason: string };
    openConnection(): void;
  }>;
}

interface BlackmiAppDefinition {
  id: string;
  name?: string;
  en?: string;
  icon?: string;
  color?: string;
  desktop?: boolean;
  wide?: boolean;
  mount(context: BlackmiAppContext): void | {
    activate?(context: BlackmiAppContext): void;
    deactivate?(context: BlackmiAppContext): void;
    unmount?(context: BlackmiAppContext): void;
  };
}

interface BlackmiAppApi {
  readonly version: '1.0';
  register(definition: BlackmiAppDefinition): string;
  launch(id: string): void;
  close(id: string): void;
  list(): Array<{ id: string; name: string; running: boolean; active: boolean; registered: boolean }>;
  networkStatus(): BlackmiRoomStatus;
  capabilities(): { localApps: true; sessionStorage: true; gameData: false };
  diagnostics(): Array<{ app: string; phase: string; message: string; time: number }>;
}

interface BlackmiGameAction extends BlackmiObject {
  readonly kind: string;
}

interface BlackmiGameState<Public extends BlackmiObject> {
  readonly id: string;
  readonly kind: string;
  readonly players: readonly string[];
  readonly phase: BlackmiGamePhase;
  readonly rev: number;
  readonly winner: string | null;
  readonly comments: readonly { id: string; name: string; text: string; time: number; spectator: boolean }[];
  readonly data: Public;
}

interface BlackmiGameSession<Action extends BlackmiGameAction> {
  status(): { playerId: string | null; role: BlackmiRole; canAct: boolean; pending: boolean };
  playerName(id: string): string;
  submit(matchId: string, action: Action): boolean;
}

interface BlackmiRoundGame<
  Public extends BlackmiObject,
  Private extends BlackmiObject,
  Action extends BlackmiGameAction
> {
  id: string;
  name: string;
  en?: string;
  color?: string;
  mark?: string;
  minPlayers: number;
  maxPlayers: number;
  createMatch(match: Readonly<{
    players: readonly string[];
    hostId: string;
    finish(winner: string | null): void;
  }>): {
    act(playerId: string, action: BlackmiGameAction): void;
    publicFor(viewerId: string | null): Public;
    privateFor?(playerId: string): Private;
    tick?(now: number): boolean;
  };
  mount(context: BlackmiAppContext, play: HTMLElement, game: BlackmiGameSession<Action>): {
    render(state: BlackmiGameState<Public>, privateState: Private | Record<string, never>): void;
    pause?(): void;
    reset?(): void;
  };
}

interface BlackmiDeveloperSdk {
  readonly version: '1.0';
  readonly apps: BlackmiAppApi;
  readonly games: Readonly<{
    register<Public extends BlackmiObject, Private extends BlackmiObject, Action extends BlackmiGameAction>(
      definition: BlackmiRoundGame<Public, Private, Action>
    ): string;
    list(): Array<{ id: string; name: string; minPlayers: number; maxPlayers: number; playerCounts: number[] }>;
    status(): { role: BlackmiRole; stage: string; count: number; match: string | null };
  }>;
}

declare const BlackmiSDK: BlackmiDeveloperSdk;
declare const BlackmiApps: BlackmiAppApi;
interface Window {
  readonly BlackmiSDK: BlackmiDeveloperSdk;
  readonly BlackmiApps: BlackmiAppApi;
}
