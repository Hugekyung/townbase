import "reflect-metadata";
import { PublicEndpoint, PUBLIC_ENDPOINT } from "../src/access/public-endpoint";

it("permits public metadata on methods and rejects class decoration at compile time", () => {
  const invalidDeclaration = () => {
    // @ts-expect-error PublicEndpoint is deliberately method-only.
    @PublicEndpoint()
    class InvalidPublicController {}
    return InvalidPublicController;
  };
  void invalidDeclaration;
  class Controller {
    @PublicEndpoint()
    read(): void {}
  }
  expect(Reflect.getMetadata(PUBLIC_ENDPOINT, Controller.prototype.read)).toBe(
    true,
  );
  expect(Reflect.getMetadata(PUBLIC_ENDPOINT, Controller)).toBeUndefined();
});
