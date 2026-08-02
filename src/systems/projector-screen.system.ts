import {
    AssetManager, ClampToEdgeWrapping,
    createSystem,
    Group, LinearFilter, LinearMipMapLinearFilter,
    Mesh,
    MeshStandardMaterial,
    Object3DEventMap,
    SRGBColorSpace,
    VisibilityState,
    Vector3
} from "@iwsdk/core";
import {ProjectorScreenComponent} from "../components/projector-screen.component";
import { socket } from "../network/socket";

export class ProjectorScreenSystem extends createSystem({
    screen: { required: [ProjectorScreenComponent] }
}) {

    private screen: Mesh | undefined;
    private material: MeshStandardMaterial | undefined;
    private slides = Array.from({length:26}, (_, idx) => `./textures/slides/Slide${idx+1}.PNG`);

    private currentIndex: number = 0;
    private isInstructor: boolean = false; // ✅ Flag to check if user is instructor
    private joystickBusy = false;

    async init() {
        // ✅ Check if this user is the instructor
        // You can set this in index.ts
        this.isInstructor = (window as any).isInstructor || false;
        console.log(`[ProjectorScreenSystem] isInstructor: ${this.isInstructor}`);

        try {
            const session = JSON.parse(
                localStorage.getItem("vrClassroomSession") ?? "{}"
            );
            const savedSlide = Number(session?.currentSlide);
            if (Number.isInteger(savedSlide) && savedSlide >= 0 && savedSlide < this.slides.length) {
                this.currentIndex = savedSlide;
            }
        } catch {
            this.currentIndex = 0;
        }

        // ✅ Listen for slide changes from instructor
        socket.on('slideChanged', (data: { index: number }) => {
            console.log(`[ProjectorScreenSystem] Slide changed to: ${data.index}`);
            this.currentIndex = data.index;
            try {
                const session = JSON.parse(
                    localStorage.getItem("vrClassroomSession") ?? "{}"
                );
                session.currentSlide = data.index;
                localStorage.setItem("vrClassroomSession", JSON.stringify(session));
            } catch {
                // The live slide still updates even if local session storage is unavailable.
            }
            this.loadSlide();
        });

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

        const slide = await AssetManager.loadTexture(this.slides[this.currentIndex], "slides")

        slide.colorSpace = SRGBColorSpace;
        slide.magFilter = LinearFilter;
        slide.minFilter = LinearMipMapLinearFilter
        slide.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
        slide.generateMipmaps = true;
        slide.wrapS = ClampToEdgeWrapping
        slide.wrapT = ClampToEdgeWrapping
        slide.repeat.x = -1
        slide.offset.x = 1
        slide.flipY = false;
        slide.needsUpdate = true;

        this.material.emissiveMap = slide
        this.material.needsUpdate = true

        ;(window as any).presentationSystem?.refreshPresentationTexture?.();
    }

    update() {
        this.world.visibilityState.subscribe(s =>  {
            if (s === VisibilityState.NonImmersive) {
                let ARROW_RIGHT_KEY = "ArrowRight"
                let ARROW_LEFT_KEY = "ArrowLeft"
                const getKeyDown = (key: string) => this.input.keyboard.getKeyDown(key);

                // ✅ Only instructor can change slides with keyboard
                if (this.isInstructor) {
                    if (getKeyDown(ARROW_LEFT_KEY)) this.previous().then()
                    if (getKeyDown(ARROW_RIGHT_KEY)) this.next().then()
                }
            } else {
                const leftCtrl = this.input.xr.gamepads.left
                const rightCtrl = this.input.xr.gamepads.right
               /*
                * Right trigger is reserved for opening
                * the instructor dashboard.
                *
                * Left trigger can still move to the
                * previous slide if you want to keep it.
                */
                if (this.isInstructor) {
                if (
                    leftCtrl &&
                    leftCtrl.getButtonDown(
                    "xr-standard-trigger"
                    )
                ) {
                    this.previous().then();
                }
                }


                /*
                 * While presenting, move the right thumbstick once to the
                 * left/right to change exactly one slide. It must return to
                 * center before another change, preventing rapid skipping.
                 */
                if (
                    this.isInstructor &&
                    (window as any).isPresentationActive &&
                    rightCtrl
                ) {
                    const thumbstick = "xr-standard-thumbstick";
                    const movedLeft = rightCtrl.getAxesEnteringLeft(thumbstick);
                    const movedRight = rightCtrl.getAxesEnteringRight(thumbstick);

                    if (!this.joystickBusy && movedLeft) {
                        this.joystickBusy = true;
                        this.previous().then();
                    } else if (!this.joystickBusy && movedRight) {
                        this.joystickBusy = true;
                        this.next().then();
                    }

                    const axes = rightCtrl.getAxesValues(thumbstick);
                    if (!axes || Math.abs(axes.x) < 0.35) {
                        this.joystickBusy = false;
                    }
                } else {
                    this.joystickBusy = false;
                }
                            }
        });
    }

    private async next() {
        if (this.currentIndex < this.slides.length - 1) {
            this.currentIndex++;
            await this.loadSlide();
            
            // ✅ Broadcast slide change to all students
            this.broadcastSlideChange();
        }
    }

    private async previous() {
        if (this.currentIndex > 0 && this.currentIndex !== 0) {
            this.currentIndex--;
            await this.loadSlide();
            
            // ✅ Broadcast slide change to all students
            this.broadcastSlideChange();
        }
    }

    // ✅ Method to broadcast slide change to all connected clients
    private broadcastSlideChange(): void {
        if (this.isInstructor) {
            console.log(`[ProjectorScreenSystem] Broadcasting slide ${this.currentIndex}`);
            socket.emit('slideChanged', { index: this.currentIndex });
        }
    }
}
