import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';

export class DynamoDb extends Construct {

    table: TableV2

    constructor(scope: Construct, id: string) {
        super(scope, id)

        this.table = new dynamodb.TableV2(this, id, {
            partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING }
        });
    }

}
