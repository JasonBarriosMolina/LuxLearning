#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { LuxLearningStack } from '../lib/lux-learning-stack';

const app = new cdk.App();

new LuxLearningStack(app, 'LuxLearningStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'Lux Learning — plataforma educativa multi-curso',
});
