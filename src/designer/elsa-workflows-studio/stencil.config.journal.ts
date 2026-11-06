import {config as base} from './stencil.config.dist';
import {Config} from '@stencil/core';
// The application consumes only the lazy Studio distribution, not the custom-element bundle.
export const config: Config = {...base, outputTargets:[{type:'dist',esmLoaderPath:'../loader',copy:[{src:'assets',dest:'assets'}]}]};
