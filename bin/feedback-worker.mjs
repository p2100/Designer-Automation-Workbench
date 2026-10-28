#!/usr/bin/env node
import {runFeedbackDelivery} from '../lib/feedback-delivery.mjs';
await runFeedbackDelivery(...process.argv.slice(2));
