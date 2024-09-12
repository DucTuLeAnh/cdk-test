import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { VpcConfig } from './vpc-config';
import { EcsCluster } from './ecsCluster';
import { AppLoadBalancer } from './app-load-balancer';

export class CdkTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpcConfig = new VpcConfig(this, "MyVpcConfig")

    const appLoadBalancer = new AppLoadBalancer(this, "MyAppLoadBalancer", vpcConfig.vpc)

    const ecsCluster = new EcsCluster(this, 'myecscluster', vpcConfig.vpc)

    appLoadBalancer.frontendTargetGroup.addTarget(ecsCluster.frontendService)
    appLoadBalancer.backendTargetGroup.addTarget(ecsCluster.backendService)

    const table: TableV2 = new dynamodb.TableV2(this, 'TestUsers', {
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING }
    });

  }
}
