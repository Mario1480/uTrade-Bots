declare module "express" {
  export type Request = any;
  export type Response = any;
  export type NextFunction = any;
  const express: any;
  export default express;
}

declare module "cors" {
  const cors: any;
  export default cors;
}

declare module "cookie-parser" {
  const cookieParser: any;
  export default cookieParser;
}

declare module "bcryptjs" {
  const bcrypt: any;
  export default bcrypt;
}

declare module "nodemailer" {
  const nodemailer: any;
  export default nodemailer;
}
