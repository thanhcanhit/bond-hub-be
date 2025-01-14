import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private jwtService: JwtService) {
    super();
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      console.log(info);
      throw new UnauthorizedException('Invalid token');
    }
    return user;
  }
}
