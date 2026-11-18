import { DataSource } from 'typeorm';
import { GooglePlacesClient } from '../../adapters/google-places.client';
import { GeoPlaceEntity } from './geo-place.entity';
import { GeoPlaceResolver } from './geo-place-resolver';
import { LaneMatchService } from './lane-match.service';

export { LaneMatchService } from './lane-match.service';
export type { BrokerLaneMatch, TransporterLaneMatch } from './lane-match.service';
export { describeMatch, routeOf } from './lane-match-rules';
export type { LaneMatch, LoadRoute, MatchKind } from './lane-match-rules';

/** Lane matching: which brokers and transporters a load goes to (see lane-match-rules.ts). */
export function createLaneMatchingModule(dataSource: DataSource): {
  laneMatchService: LaneMatchService;
} {
  const geo = new GeoPlaceResolver(
    dataSource.getRepository(GeoPlaceEntity),
    new GooglePlacesClient(),
  );
  return { laneMatchService: new LaneMatchService(dataSource, geo) };
}
