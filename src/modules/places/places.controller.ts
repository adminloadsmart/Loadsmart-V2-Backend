import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { PlacesService } from './places.service';
import { PlaceDetailsQuery, PlaceParams, SearchPlacesQuery } from './places.types';

export class PlacesController {
  constructor(private readonly service: PlacesService) {}

  // Reads req.validatedQuery, not req.query — see validate.middleware.ts.
  search = async (req: Request, res: Response) =>
    respond(res, await this.service.search(req.validatedQuery as SearchPlacesQuery));

  details = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.getDetails(
        (req.params as unknown as PlaceParams).placeId,
        (req.validatedQuery as PlaceDetailsQuery).sessionToken,
      ),
    );
}
