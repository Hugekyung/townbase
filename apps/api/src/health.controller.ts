import { Controller, Get } from "@nestjs/common";

type HealthResponse = {
  readonly status: "ok";
};

@Controller()
export class HealthController {
  @Get("health")
  public getHealth(): HealthResponse {
    return {
      status: "ok",
    };
  }
}
