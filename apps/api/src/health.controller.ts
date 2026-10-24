import { PublicEndpoint } from "./access/public-endpoint";
import { Controller, Get } from "@nestjs/common";

type HealthResponse = {
  readonly status: "ok";
};

@Controller()
export class HealthController {
  @PublicEndpoint()
  @Get("health")
  public getHealth(): HealthResponse {
    return {
      status: "ok",
    };
  }
}
