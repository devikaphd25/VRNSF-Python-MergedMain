/**
 * Celebratory gold-coin splash, shared by all three Python puzzles.
 *
 * A solved board erupts into a fountain of coins in front of the student: they
 * burst upward and outward from the player, arc back down under gravity, fade
 * out and remove themselves, so the cheer costs nothing once it has played.
 * One geometry and one material drive the whole burst, and the coin size
 * follows the puzzle's scale factor so it reads the same in every room.
 */
import {
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Object3D,
} from "three";

/** Big enough to read as a cheer, small enough to stay cheap on Quest. */
const COIN_COUNT = 60;
/** Seconds a coin stays in the air before it fades away. */
const AIR_TIME_SECONDS = 3;
const GRAVITY = -5;
const GOLD_COLOR = 0xffd700;
/** The burst starts this far above the player's origin, at chest height. */
const BURST_HEIGHT = 1.0;

export interface Coin {
  mesh: Mesh;
  velocity: Vector3;
  /** Fade factor from 1 down to 0; also the coin's opacity. */
  life: number;
}

export interface CoinSplashOptions {
  /** Parents a coin to the room root, so leaving the room removes it too. */
  attach: (coin: Object3D) => void;
  /** Player position the coins erupt from. */
  resolveOrigin: () => Vector3;
  /** Puzzle scale factor: the coins track the board the student looks at. */
  scale: number;
}

export interface CoinSplash {
  /** Starts a fresh burst, replacing any coins still in the air. */
  start(): void;
  /** Advances the burst; a no-op once every coin has faded. */
  update(delta: number): void;
  /** Removes any coins left in the air (leaving or tearing down the room). */
  clear(): void;
  readonly coins: Coin[];
  readonly active: boolean;
}

export function createCoinSplash({
  attach,
  resolveOrigin,
  scale,
}: CoinSplashOptions): CoinSplash {
  const geometry = new CylinderGeometry(
    0.03 * scale,
    0.03 * scale,
    0.008 * scale,
    12,
  );
  const material = new MeshStandardMaterial({
    color: GOLD_COLOR,
    emissive: GOLD_COLOR,
    emissiveIntensity: 0.4,
    metalness: 0.9,
    roughness: 0.2,
    transparent: true,
  });
  const coins: Coin[] = [];

  const clear = (): void => {
    for (const coin of coins) {
      coin.mesh.parent?.remove(coin.mesh);
    }
    coins.length = 0;
    material.opacity = 1;
  };

  return {
    get coins(): Coin[] {
      return coins;
    },

    get active(): boolean {
      return coins.length > 0;
    },

    start(): void {
      clear();

      const origin = resolveOrigin();
      for (let index = 0; index < COIN_COUNT; index++) {
        const angle =
          (index / COIN_COUNT) * Math.PI * 2 + Math.random() * 0.3;
        const radius = 0.1 + Math.random() * 0.5;

        const coin = new Mesh(geometry, material);
        coin.position.set(
          origin.x + Math.cos(angle) * radius,
          origin.y + BURST_HEIGHT,
          origin.z + Math.sin(angle) * radius,
        );

        // Shoot upward and outward; gravity brings them back down.
        const velocity = new Vector3(
          Math.cos(angle) * (1.5 + Math.random() * 2),
          4 + Math.random() * 4,
          Math.sin(angle) * (1.5 + Math.random() * 2),
        );

        coins.push({ mesh: coin, velocity, life: 1 });
        attach(coin);
      }
    },

    update(delta: number): void {
      if (coins.length === 0) return;

      for (let index = coins.length - 1; index >= 0; index--) {
        const coin = coins[index];
        coin.life -= delta / AIR_TIME_SECONDS;

        if (coin.life <= 0) {
          coin.mesh.parent?.remove(coin.mesh);
          coins.splice(index, 1);
          continue;
        }

        coin.velocity.y += GRAVITY * delta;
        coin.mesh.position.addScaledVector(coin.velocity, delta);
        coin.mesh.rotation.x += delta * 5;
        coin.mesh.rotation.z += delta * 3;
      }

      // Every coin is on the same schedule, so one fade drives the burst.
      material.opacity = coins.length > 0 ? Math.max(0, coins[0].life) : 0;
    },

    clear,
  };
}
