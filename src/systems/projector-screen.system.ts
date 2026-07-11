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

    async init() {
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
    }

    update() {

        this.world.visibilityState.subscribe(s =>  {
            if (s === VisibilityState.NonImmersive) {
                let ARROW_RIGHT_KEY = "ArrowRight"
                let ARROW_LEFT_KEY = "ArrowLeft"
                const getKeyDown = (key: string) => this.input.keyboard.getKeyDown(key);

                if (getKeyDown(ARROW_LEFT_KEY)) this.previous().then()

                if (getKeyDown(ARROW_RIGHT_KEY)) this.next().then()
            }  else {
                const leftCtrl = this.input.xr.gamepads.left
                const rightCtrl = this.input.xr.gamepads.right

                if (leftCtrl && leftCtrl.getButtonDown("xr-standard-trigger")) {
                    this.previous().then()
                }

                if (rightCtrl && rightCtrl.getButtonDown("xr-standard-trigger")) {
                    this.next().then()
                }
            }
        });
    }

    private async next() {
        if (this.currentIndex < this.slides.length - 1){
            this.currentIndex++;
            await this.loadSlide()
        }
    }

    private async previous() {
        if (this.currentIndex > 0 && this.currentIndex !== 0) {
            this.currentIndex--;
            await this.loadSlide()
        }
    }
}