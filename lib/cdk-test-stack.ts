import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { VpcConfig } from './infrastructure/vpc-config';
import { EcsCluster } from './infrastructure/ecs-cluster';
import { AppLoadBalancer } from './infrastructure/app-load-balancer';
import { DynamoDb } from './backend/db/dynamo-db';

export class CdkTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpcConfig = new VpcConfig(this, "myvpc")

    const appLoadBalancer = new AppLoadBalancer(this, "mylb", vpcConfig.vpc)

    const ecsCluster = new EcsCluster(this, 'myecscluster', vpcConfig.vpc)

    appLoadBalancer.frontendTargetGroup.addTarget(ecsCluster.frontendService)
    appLoadBalancer.backendTargetGroup.addTarget(ecsCluster.backendService)

    const dynamodb = new DynamoDb(this, "mydynamodb")

  }
}
