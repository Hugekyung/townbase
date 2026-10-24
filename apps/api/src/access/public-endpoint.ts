import { SetMetadata } from "@nestjs/common";
export const PUBLIC_ENDPOINT = Symbol("townbase.public-endpoint");
// Method-only opt-out. No controller-wide or caller-controlled authentication bypass.
export const PublicEndpoint = (): MethodDecorator =>
  SetMetadata(PUBLIC_ENDPOINT, true);
