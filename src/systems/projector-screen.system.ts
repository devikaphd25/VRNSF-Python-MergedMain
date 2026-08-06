import {
    createSystem,
    Group,
    Mesh,
    MeshStandardMaterial,
    Object3DEventMap
} from "@iwsdk/core";
import {ProjectorScreenComponent} from "../components/projector-screen.component";
import { socket } from "../network/socket";

export class ProjectorScreenSystem extends createSystem({
    screen: { required: [ProjectorScreenComponent] }
}) {

    private screen: Mesh | undefined;
    private material: MeshStandardMaterial | undefined;
    private currentIndex: number = 0;
    private isInstructor: boolean = false; // ✅ Flag to check if user is instructor
    private joystickBusy = false;

    async init() {
        // ✅ Check if this user is the instructor
        // You can set this in index.ts
        this.isInstructor = (window as any).isInstructor || false;
        console.log(`[ProjectorScreenSystem] isInstructor: ${this.isInstructor}`);

        this.queries.screen.subscribe("qualify", async (e) =>  {

            const scene = e.getValue(ProjectorScreenComponent, 'scene') as Group<Object3DEventMap>;
            if (!scene) return;

            this.screen = scene.getObjectByName("ProjectorScreen")  as Mesh
            
            this.material = this.screen.material as MeshStandardMaterial;

            await this.loadSlide()
        })
    }

    private async loadSlide() {
        if (!this.material) return

        // Presentation files are intentionally disabled. Release any texture
        // embedded on the projector and leave a lightweight dark OFF screen.
        const previousMap = this.material.map;
        const previousEmissiveMap = this.material.emissiveMap;
        this.material.map = null;
        this.material.emissiveMap = null;
        if (previousMap) previousMap.dispose();
        if (previousEmissiveMap && previousEmissiveMap !== previousMap) {
            previousEmissiveMap.dispose();
        }
        this.material.color.setHex(0x080b10);
        this.material.emissive.setHex(0x000000);
        this.material.roughness = 0.82;
        this.material.metalness = 0.05;
        this.material.needsUpdate = true
    }

    update() {}

    private async next() {
        await this.loadSlide();
    }

    private async previous() {
        await this.loadSlide();
    }

    // ✅ Method to broadcast slide change to all connected clients
    private broadcastSlideChange(): void {
        if (this.isInstructor) {
            console.log(`[ProjectorScreenSystem] Broadcasting slide ${this.currentIndex}`);
            socket.emit('slideChanged', { index: this.currentIndex });
        }
    }
}
