import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, ClearPass,
  BloomEffect, SMAAEffect, SMAAPreset, VignetteEffect, ToneMappingEffect, ToneMappingMode,
  HueSaturationEffect, BrightnessContrastEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

// Pipeline de imagem: mundo → oclusão de ambiente → arma por cima → brilho, cor, vinheta, anti-serrilhado.
export function createPipeline(renderer, scene, camera, weaponScene, weaponCam, quality) {
  if (quality === 'low') {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    return {
      render() {
        renderer.autoClear = false;
        renderer.clear();
        renderer.render(scene, camera);
        renderer.clearDepth();
        renderer.render(weaponScene, weaponCam);
      },
      setSize() {},
      dispose() {},
    };
  }
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = true;
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));

  const ao = new N8AOPostPass(scene, camera, innerWidth, innerHeight);
  ao.configuration.aoRadius = 3.0;
  ao.configuration.distanceFalloff = 1.0;
  ao.configuration.intensity = 2.2;
  ao.configuration.aoSamples = quality === 'high' ? 16 : 8;
  ao.configuration.denoiseSamples = quality === 'high' ? 8 : 4;
  ao.configuration.halfRes = false; // meia resolução usa alvo múltiplo incompatível com three r187
  ao.configuration.gammaCorrection = false;
  composer.addPass(ao);

  // arma em 1ª pessoa desenhada por cima do mundo
  composer.addPass(new ClearPass(false, true, false));
  const wp = new RenderPass(weaponScene, weaponCam);
  wp.clear = false;
  composer.addPass(wp);

  const effects = [
    new BloomEffect({ intensity: 0.2, luminanceThreshold: 1.0, luminanceSmoothing: 0.12, mipmapBlur: true }),
    new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
    new BrightnessContrastEffect({ brightness: -0.02, contrast: 0.12 }),
    new HueSaturationEffect({ saturation: -0.08 }),
    new VignetteEffect({ darkness: 0.42, offset: 0.32 }),
    new SMAAEffect({ preset: quality === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM }),
  ];
  composer.addPass(new EffectPass(camera, ...effects));

  return {
    composer, ao, effects,
    render(dt) { composer.render(dt); },
    setSize(w, h) { composer.setSize(w, h); ao.setSize && ao.setSize(w, h); },
    dispose() { composer.dispose(); },
  };
}
