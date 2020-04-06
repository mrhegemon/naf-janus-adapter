var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { debug } from '../util';
export default class TimeHandler {
    constructor(application) {
        this.timeOffsets = [];
        this.serverTimeRequests = 0;
        this.avgTimeOffset = 0;
        this.getServerTime = () => Date.now() + this.avgTimeOffset;
        this.updateTimeOffset = () => __awaiter(this, void 0, void 0, function* () {
            if (this.application.connectionHandler.isDisconnected())
                return;
            const res = yield fetch(document.location.href, { method: 'HEAD', cache: 'no-cache', });
            const timeOffset = new Date(res.headers.get('Date')).getTime() - Date.now();
            this.serverTimeRequests++;
            if (this.serverTimeRequests <= 10)
                this.timeOffsets.push(timeOffset);
            else
                this.timeOffsets[this.serverTimeRequests % 10] = timeOffset;
            this.avgTimeOffset = this.timeOffsets.reduce((acc, offset) => (acc += offset), 0) / this.timeOffsets.length;
            if (this.serverTimeRequests <= 10)
                return this.updateTimeOffset();
            debug(`new server time offset: ${this.avgTimeOffset}ms`);
            setTimeout(() => this.updateTimeOffset(), 5 * 60 * 1000); // Sync clock every 5 minutes.
        });
        this.application = application;
    }
}
