import { OnEvent } from '@nestjs/event-emitter';
import { Events } from 'mezon-sdk';
import { Injectable } from '@nestjs/common';
import { RoleService } from '../commands/selfAssignableRoles/role.service';
import { LiengService } from '../commands/lieng/lieng.service';

interface ButtonEventData {
  button_id: string;
  user_id: string;
  message_id: string;
  channel_id?: string;
}

@Injectable()
export class ListenerMessageButtonClicked {
  constructor(
    private roleService: RoleService,
    private liengService: LiengService,
  ) {}

  @OnEvent(Events.MessageButtonClicked)
  async handleButtonForm(data: ButtonEventData) {
    try {
      const args = data.button_id.split('_');
      const buttonConfirmType = args[0];

      switch (buttonConfirmType) {
        case 'role':
          await this.handleSelectRole(data);
          break;
        case 'lieng':
          await this.handleLieng(data);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error('Error handling button click:', error);
    }
  }

  async handleSelectRole(data: any) {
    try {
      await this.roleService.handleSelectRole(data);
    } catch (error) {
      console.error('Error handling role select:', error);
    }
  }

  async handleLieng(data: ButtonEventData) {
    try {
      await this.liengService.handleInteraction(
        data.button_id,
        data.user_id,
        data.message_id,
      );
    } catch (e) {
      console.error(e);
    }
  }
}
